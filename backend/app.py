import os
import json
import threading
import time
import uuid
import re
from datetime import datetime, timedelta
from functools import wraps

from sqlalchemy import and_, or_
from sqlalchemy.exc import OperationalError

from flask import Flask, request, jsonify, render_template, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
import jwt

# Config
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DEFAULT_DB_PATH = os.path.join(BASE_DIR, 'trapchat.db')
DB_PATH = os.environ.get('DATABASE_URL', f'sqlite:///{DEFAULT_DB_PATH}')
SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-change-in-production')
JWT_EXP_HOURS = 24 * 30  # 30 days
# How long a queued match stays joinable. Past this it is treated as abandoned.
QUEUE_TIMEOUT_MINUTES = 5
# How long an empty room lingers before it is deleted, front and back.
EMPTY_ROOM_TIMEOUT_SECONDS = 60

# Rating every player starts at, and what a guest counts as when pairing.
DEFAULT_RATING = 1000

# Matchmaking reads the queue and then writes to it, so two callers arriving
# together could both find it empty and both create a match, leaving each
# alone. This serialises that section. It holds for this deployment because the
# backend is one replica running one worker; moving to several processes means
# moving this guarantee into the database with SELECT ... FOR UPDATE.
MATCHMAKING_LOCK = threading.Lock()

SOCIAL = 'social'
COMPETITIVE = 'competitive'
RETIRED = 'retired'

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['SQLALCHEMY_DATABASE_URI'] = DB_PATH
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
if DB_PATH.startswith('sqlite'):
    # In production this SQLite file lives on an Azure Files share, where a
    # restarting revision can still be holding the write lock. The pysqlite
    # default gives up after 5 seconds and raises "database is locked", which
    # kills the Gunicorn worker before it ever binds a port. Wait instead.
    # check_same_thread is required because Gunicorn serves requests from a
    # thread pool, so pooled connections move between threads.
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        'connect_args': {'timeout': 30, 'check_same_thread': False},
        'pool_pre_ping': True,
    }
app.config['SECRET_KEY'] = SECRET_KEY
FRONTEND_ORIGIN = os.environ.get('FRONTEND_ORIGIN')
if FRONTEND_ORIGIN:
    CORS(app, supports_credentials=True, origins=FRONTEND_ORIGIN)
else:
    # No origin pinned, which is the local development case. This still has to
    # negotiate credentialed CORS: the frontend sends every request with
    # credentials: 'include', and a browser discards the response unless
    # Access-Control-Allow-Credentials is true. Flask-CORS echoes the caller's
    # origin rather than '*' once supports_credentials is set, which is what
    # browsers require for credentialed requests.
    CORS(app, supports_credentials=True)


# Login is the only endpoint worth guessing at, so attempts per caller are
# capped. Held in memory, which is sound while the backend is one replica; more
# than one would need this in shared storage to be a real limit.
LOGIN_MAX_ATTEMPTS = 10
LOGIN_WINDOW_SECONDS = 300
_LOGIN_ATTEMPTS = {}
_RATE_LIMIT_LOCK = threading.Lock()


def reset_rate_limits():
    """Used by tests, which would otherwise inherit each other's counters."""
    with _RATE_LIMIT_LOCK:
        _LOGIN_ATTEMPTS.clear()


def caller_key():
    forwarded = request.headers.get('X-Forwarded-For', '')
    # Container Apps sits behind a proxy, so the client address is the first
    # entry in the forwarded chain rather than the socket peer.
    return (forwarded.split(',')[0].strip() or request.remote_addr or 'unknown')


def rate_limited(bucket):
    """Record an attempt and report how long to wait, or None to proceed."""
    now = time.time()
    key = (bucket, caller_key())
    with _RATE_LIMIT_LOCK:
        attempts = [t for t in _LOGIN_ATTEMPTS.get(key, []) if now - t < LOGIN_WINDOW_SECONDS]
        if len(attempts) >= LOGIN_MAX_ATTEMPTS:
            _LOGIN_ATTEMPTS[key] = attempts
            return int(LOGIN_WINDOW_SECONDS - (now - attempts[0])) + 1
        attempts.append(now)
        _LOGIN_ATTEMPTS[key] = attempts
    return None


def clear_rate_limit(bucket):
    """A successful sign-in means this caller is not the one guessing."""
    with _RATE_LIMIT_LOCK:
        _LOGIN_ATTEMPTS.pop((bucket, caller_key()), None)


def cookie_options():
    cross_origin = bool(FRONTEND_ORIGIN)
    return {
        'httponly': True,
        'secure': cross_origin,
        'samesite': 'None' if cross_origin else 'Lax',
        'max_age': JWT_EXP_HOURS * 3600,
    }

db = SQLAlchemy(app)
bcrypt = Bcrypt(app)
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')

def _storage_metadata():
    engine = db.engine
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql("SELECT 1")
    except Exception:
        return {"storage": engine.url.get_backend_name(), "productionReadyStorage": False}
    return {"storage": engine.url.get_backend_name(), "productionReadyStorage": True}


@app.get('/health')
@app.get('/api/health')
def health():
    return jsonify({
        'ok': True,
        'service': 'trap-chat-backend',
        # The commit this build came from. A deploy can then be waited on
        # rather than assumed: a health check alone passes on the revision
        # that was already serving.
        'version': os.environ.get('GIT_SHA', 'unknown'),
        **_storage_metadata(),
    })

# -------------------------
# Models
# -------------------------
class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False, index=True)
    email = db.Column(db.String(120), unique=True, nullable=True, index=True)
    password_hash = db.Column(db.String(128), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    preferences_json = db.Column(db.Text, default='{}')
    lat = db.Column(db.Float, nullable=True)
    lng = db.Column(db.Float, nullable=True)
    rating = db.Column(db.Integer, default=1000)

    def set_password(self, pw):
        self.password_hash = bcrypt.generate_password_hash(pw).decode('utf-8')

    def check_password(self, pw):
        return bcrypt.check_password_hash(self.password_hash, pw)

    def to_token(self):
        payload = {'uid': self.id, 'exp': datetime.utcnow() + timedelta(hours=JWT_EXP_HOURS)}
        return jwt.encode(payload, SECRET_KEY, algorithm='HS256')

    @staticmethod
    def from_token(token):
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=['HS256'])
            return db.session.get(User, payload['uid'])
        except Exception:
            return None

    def prefs(self):
        try:
            return json.loads(self.preferences_json or '{}')
        except Exception:
            return {}

    def set_prefs(self, d):
        self.preferences_json = json.dumps(d)


class Game(db.Model):
    __tablename__ = 'games'
    id = db.Column(db.Integer, primary_key=True)
    slug = db.Column(db.String(30), unique=True, nullable=False, index=True)
    name = db.Column(db.String(50), nullable=False)
    max_players = db.Column(db.Integer, nullable=False)
    is_1v1 = db.Column(db.Boolean, nullable=False, default=False)
    default_time_sec = db.Column(db.Integer, default=60)
    # 'social' (drop-in channels, joinable by room code), 'competitive'
    # (ranked matchmaking only) or 'retired' (kept for old matches' foreign
    # keys, never listed).
    category = db.Column(db.String(20), nullable=False, default=SOCIAL, index=True)


class Match(db.Model):
    __tablename__ = 'matches'
    id = db.Column(db.Integer, primary_key=True)
    game_id = db.Column(db.Integer, db.ForeignKey('games.id'), nullable=False, index=True)
    room_code = db.Column(db.String(12), unique=True, nullable=False, index=True)
    status = db.Column(db.String(20), nullable=False, default='waiting')  # waiting, active, finished
    host_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    settings_json = db.Column(db.Text, default='{}')
    started_at = db.Column(db.DateTime, nullable=True)
    finished_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    game = db.relationship('Game', backref='matches')


class MatchPlayer(db.Model):
    __tablename__ = 'match_players'
    id = db.Column(db.Integer, primary_key=True)
    match_id = db.Column(db.Integer, db.ForeignKey('matches.id'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True, index=True)
    guest_session_id = db.Column(db.String(64), nullable=True, index=True)
    display_name = db.Column(db.String(50), nullable=False)
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)
    left_at = db.Column(db.DateTime, nullable=True)
    result_json = db.Column(db.Text, nullable=True)

    match = db.relationship('Match', backref='players')
    user = db.relationship('User', backref='match_players')


class BattleVote(db.Model):
    """One audience vote in a judged battle.

    Rap Battle and Looks Battle have no objective winner, and every real
    battle rap platform settles that the same way: the room decides. The flow
    score sitting next to this measures whether someone was on beat, which is
    not the same question as who won.
    """

    __tablename__ = 'battle_votes'
    id = db.Column(db.Integer, primary_key=True)
    match_id = db.Column(db.Integer, db.ForeignKey('matches.id'), nullable=False, index=True)
    # Whoever is voting, by the same two identities everything else uses.
    voter_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True, index=True)
    voter_guest_session = db.Column(db.String(64), nullable=True, index=True)
    for_player_id = db.Column(db.Integer, db.ForeignKey('match_players.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    match = db.relationship('Match', backref='votes')
    for_player = db.relationship('MatchPlayer', backref='votes')


class Leaderboard(db.Model):
    __tablename__ = 'leaderboards'
    id = db.Column(db.Integer, primary_key=True)
    game_id = db.Column(db.Integer, db.ForeignKey('games.id'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    best_score = db.Column(db.Float, nullable=False)
    achieved_at = db.Column(db.DateTime, default=datetime.utcnow)

    __table_args__ = (db.UniqueConstraint('game_id', 'user_id', name='uix_game_user'),)

    game = db.relationship('Game', backref='leaderboard')
    user = db.relationship('User', backref='leaderboard')


class GuestProfile(db.Model):
    """A guest is still a person: this is the name they picked, kept against
    their session so it survives a reload."""
    __tablename__ = 'guest_profiles'
    session_id = db.Column(db.String(64), primary_key=True)
    display_name = db.Column(db.String(50), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Room(db.Model):
    __tablename__ = 'rooms'
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(12), unique=True, nullable=False, index=True)
    game_id = db.Column(db.Integer, db.ForeignKey('games.id'), nullable=False)
    host_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    settings_json = db.Column(db.Text, default='{}')
    status = db.Column(db.String(20), nullable=False, default='open')  # open, locked, in_progress, closed
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    # What the creator called it, so it is findable when browsing.
    name = db.Column(db.String(60), nullable=True)

    game = db.relationship('Game', backref='rooms')


# -------------------------
# Helpers
# -------------------------
# The frontend and backend are on different sites, so every cookie set here is
# a third-party cookie: Chrome incognito drops them, and Safari and Firefox
# restrict them. Read credentials from headers first and treat cookies as a
# same-site convenience, otherwise a privacy-respecting browser cannot sign in.
def bearer_token():
    header = request.headers.get('Authorization', '')
    if header.startswith('Bearer '):
        candidate = header[7:].strip()
        if candidate:
            return candidate
    return request.cookies.get('auth_token')


def guest_session_id():
    return request.headers.get('X-Guest-Session') or request.cookies.get('guest_session')


def current_user():
    token = bearer_token()
    return User.from_token(token) if token else None


def auth_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not bearer_token():
            return jsonify({'error': 'Unauthorized'}), 401
        user = current_user()
        if not user:
            return jsonify({'error': 'Invalid token'}), 401
        request.user = user
        return f(*args, **kwargs)
    return wrapper


def optional_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        request.user = current_user()
        return f(*args, **kwargs)
    return wrapper


def guest_or_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        user = current_user()
        if user:
            request.user = user
            request.guest = False
            return f(*args, **kwargs)

        if not guest_session_id():
            return jsonify({'error': 'guest session required'}), 401

        request.user = None
        request.guest = True
        return f(*args, **kwargs)
    return wrapper


# Which matches a socket is currently connected to, and when one was last
# seen. left_at is only ever written by a socket event, so a player who joined
# a room over HTTP and never opened a socket -- or whose socket was lost when
# the container restarted -- held their seat forever and kept the room in
# Browse for good. Presence is therefore observed here instead of inferred.
# Single process, the same assumption MATCHMAKING_LOCK already makes.
MATCH_LAST_SEEN = {}
MATCH_LAST_SEEN_LOCK = threading.Lock()
PROCESS_STARTED_AT = datetime.utcnow()


def touch_match_presence(match_id):
    with MATCH_LAST_SEEN_LOCK:
        MATCH_LAST_SEEN[match_id] = datetime.utcnow()


def match_last_seen(match_id):
    """When a socket was last connected to this match.

    A match this process has never seen a socket for counts as last seen when
    the process started, not now: a restart drops every socket, so the rooms
    that survived it get one full timeout to be reconnected to, while a room
    nobody has touched since long before then is simply abandoned.
    """
    with MATCH_LAST_SEEN_LOCK:
        return MATCH_LAST_SEEN.setdefault(match_id, PROCESS_STARTED_AT)


def refresh_live_presence():
    """Someone sitting quietly in a group chat sends no events for minutes, so
    presence cannot come from traffic. Anyone still holding a socket counts."""
    for identity in list(SOCKET_IDENTITIES.values()):
        for match_id in list(identity.get('matches', ())):
            touch_match_presence(match_id)


def purge_abandoned_rooms():
    """Delete rooms whose players have all left for longer than the timeout.

    Nobody should browse into a room that everyone abandoned, so the instance
    disappears from the backend as well as the UI. Runs lazily on the paths
    that read rooms, which avoids a background thread and keeps the work
    proportional to actual traffic.
    """
    refresh_live_presence()
    cutoff = datetime.utcnow() - timedelta(seconds=EMPTY_ROOM_TIMEOUT_SECONDS)
    for room in Room.query.all():
        match = Match.query.filter_by(room_code=room.code).first()
        if match is None:
            # A room that never became a match is abandoned once it is old.
            if room.created_at and room.created_at < cutoff:
                db.session.delete(room)
            continue
        players = MatchPlayer.query.filter_by(match_id=match.id).all()
        # A seat that was never released still counts as empty once nobody has
        # been connected to the room for the timeout.
        if [p for p in players if p.left_at is None] and match_last_seen(match.id) > cutoff:
            continue
        last_seen = max((p.left_at for p in players if p.left_at), default=None)
        if last_seen is not None and last_seen > cutoff:
            continue
        if not players and room.created_at and room.created_at >= cutoff:
            continue
        for player in players:
            db.session.delete(player)
        db.session.delete(match)
        db.session.delete(room)
    db.session.commit()


def present_players(match):
    """Players actually in the match. Someone who left still has a row, and
    counting them made a room with a ghost look full."""
    return [p for p in match.players if p.left_at is None]


def match_player_count(match):
    return len(present_players(match))


def start_if_ready(match, game):
    """Start a match the moment it has a full complement.

    Every path that can add a player ends here, including the one that hands
    back a match you were already in. Skipping this check on that path left
    complete matches sitting on 'waiting', so both players watched a spinner
    while the room quietly had two people in it.
    """
    if match.status != 'waiting' or len(present_players(match)) < 2:
        return False
    match.status = 'active'
    match.started_at = datetime.utcnow()
    db.session.commit()
    socketio.emit(
        'match_start',
        {'match_id': match.id, 'room_code': match.room_code, 'game': game.slug},
        to=f'match_{match.id}',
    )
    return True


# Rate the fastest credible athlete at two reps a second and give the clock a
# few seconds of slack. Anything past that did not happen.
MAX_REPS_PER_SECOND = 2
CLOCK_SLACK_SECONDS = 5


def validate_result(game, data):
    """Return a reason to reject this result, or None if it is plausible.

    The check is deliberately generous. It is not trying to spot a good player
    from a great one, only to keep a number typed into the console out of the
    leaderboard.
    """
    if not isinstance(data, dict):
        return 'result must be an object'

    score = data.get('score')
    if score is None:
        return None  # A result without a score never reaches the leaderboard.
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        return 'score must be a number'
    if score < 0:
        return 'score cannot be negative'

    if game is not None and game.slug in REP_COUNTED_GAMES:
        window = (game.default_time_sec or 60) + CLOCK_SLACK_SECONDS
        ceiling = window * MAX_REPS_PER_SECOND
        if score > ceiling:
            return f'score of {score} is not possible in {game.default_time_sec}s'
    return None


def purge_impossible_scores():
    """Drop leaderboard rows that the current rules would reject.

    Scores were once taken on trust, so the ladder can hold numbers that are
    not possible. Validation only guards new submissions; this makes the rule
    retroactive rather than leaving a bogus entry at the top forever.
    """
    removed = 0
    for entry in Leaderboard.query.all():
        game = db.session.get(Game, entry.game_id)
        if validate_result(game, {'score': entry.best_score}):
            db.session.delete(entry)
            removed += 1
    if removed:
        db.session.commit()
        app.logger.warning('dropped %s leaderboard entries that are not possible', removed)
    return removed


def gen_room_code():
    return uuid.uuid4().hex[:8].upper()


def haversine(lat1, lng1, lat2, lng2):
    from math import radians, sin, cos, sqrt, atan2
    R = 6371  # km
    dlat = radians(lat2 - lat1)
    dlng = radians(lng2 - lng1)
    a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng/2)**2
    return 2 * R * atan2(sqrt(a), sqrt(1-a))


# -------------------------
# Seed Games
# -------------------------
DEFAULT_GAMES = [
    # Competitive: ranked 1v1, matchmaking only, feeds the leaderboards.
    {'slug': 'pushups', 'name': 'Push-Ups', 'max_players': 2, 'is_1v1': True, 'default_time_sec': 60, 'category': COMPETITIVE},
    {'slug': 'squats', 'name': 'Squats', 'max_players': 2, 'is_1v1': True, 'default_time_sec': 60, 'category': COMPETITIVE},
    {'slug': 'rapbattle', 'name': 'Rap Battle', 'max_players': 2, 'is_1v1': True, 'default_time_sec': 60, 'category': COMPETITIVE},
    # Facial Symmetry and Mog were the same contest under two names.
    {'slug': 'looks', 'name': 'Looks Battle', 'max_players': 2, 'is_1v1': True, 'default_time_sec': 30, 'category': COMPETITIVE},
    # Social: drop-in channels, browsable and joinable by code, never ranked.
    {'slug': 'chat1v1', 'name': '1:1 Chat', 'max_players': 2, 'is_1v1': True, 'default_time_sec': 0, 'category': SOCIAL},
    {'slug': 'groupchat', 'name': 'Group Chat', 'max_players': 20, 'is_1v1': False, 'default_time_sec': 0, 'category': SOCIAL},
]

# Slugs that existed before the catalog was reorganised. They stay in the table
# so old matches keep their foreign key, but they are never offered again.
# Games whose score is a rep count, so a per-second ceiling applies.
REP_COUNTED_GAMES = {'pushups', 'squats'}

REPLACED_GAMES = {'symmetry': 'looks', 'mog': 'looks', 'textchat': 'chat1v1', 'ffa': 'groupchat'}


def _ensure_schema():
    """create_all never alters an existing table, so a database written by an
    older build is missing newer columns. Add them in place."""
    from sqlalchemy import inspect, text

    inspector = inspect(db.engine)
    if 'games' not in inspector.get_table_names():
        return
    columns = {c['name'] for c in inspector.get_columns('games')}
    if 'category' not in columns:
        db.session.execute(text(
            f"ALTER TABLE games ADD COLUMN category VARCHAR(20) NOT NULL DEFAULT '{SOCIAL}'"
        ))
        db.session.commit()
    if 'rooms' in inspector.get_table_names():
        room_columns = {c['name'] for c in inspector.get_columns('rooms')}
        if 'name' not in room_columns:
            db.session.execute(text("ALTER TABLE rooms ADD COLUMN name VARCHAR(60)"))
            db.session.commit()


def _seed_games():
    for spec in DEFAULT_GAMES:
        game = Game.query.filter_by(slug=spec['slug']).first()
        if game is None:
            db.session.add(Game(**spec))
        else:
            # Keep names and categories current without disturbing history.
            for field, value in spec.items():
                setattr(game, field, value)
    db.session.commit()
    # Retire superseded rows in one statement. They keep existing so old
    # matches still resolve their foreign key, they are just never offered.
    Game.query.filter(Game.slug.in_(list(REPLACED_GAMES))).update(
        {Game.category: RETIRED}, synchronize_session=False
    )
    db.session.commit()

def _initialize_database(attempts=12, delay=5):
    """Create tables and seed the game catalog.

    A redeploy briefly overlaps the outgoing and incoming revisions, and both
    mount the same Azure Files share. Retry rather than letting a transient
    lock during schema creation take the whole worker down.
    """
    last_error = None
    for attempt in range(1, attempts + 1):
        try:
            with app.app_context():
                db.create_all()
                _ensure_schema()
                _seed_games()
                purge_impossible_scores()
            return
        except OperationalError as exc:
            last_error = exc
            with app.app_context():
                db.session.rollback()
            app.logger.warning(
                'database not ready, attempt %s/%s: %s', attempt, attempts, exc
            )
            if attempt < attempts:
                time.sleep(delay)
    raise last_error


_initialize_database()


# -------------------------
# Routes: Static / Pages
# -------------------------
@app.route('/')
def index():
    return render_template('landing.html')


@app.route('/lobby')
@optional_auth
def lobby():
    return render_template('lobby.html', user=getattr(request, 'user', None))


@app.route('/game/<slug>')
@guest_or_auth
def game_room(slug):
    game = Game.query.filter_by(slug=slug).first_or_404()
    return render_template('game.html', game=game, user=getattr(request, 'user', None), guest=getattr(request, 'guest', False))


@app.route('/room/<code>')
@guest_or_auth
def room_view(code):
    room = Room.query.filter_by(code=code).first_or_404()
    return render_template('room.html', room=room, user=getattr(request, 'user', None), guest=getattr(request, 'guest', False))


@app.route('/static/<path:path>')
def static_files(path):
    return send_from_directory('static', path)


# -------------------------
# Auth API
# -------------------------
@app.route('/api/auth/register', methods=['POST'])
def api_register():
    retry_after = rate_limited('register')
    if retry_after is not None:
        return jsonify({
            'error': 'too many sign-up attempts, try again shortly',
            'retry_after': retry_after,
        }), 429

    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip() or None
    password = data.get('password') or ''
    if not username or not password:
        return jsonify({'error': 'username and password required'}), 400
    if not re.fullmatch(r'[A-Za-z0-9_-]{3,50}', username):
        return jsonify({'error': 'username must be 3-50 letters, numbers, _ or -'}), 400
    if len(password) < 8:
        return jsonify({'error': 'password must be at least 8 characters'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'username taken'}), 400
    if email and User.query.filter_by(email=email).first():
        return jsonify({'error': 'email taken'}), 400
    u = User(username=username, email=email)
    u.set_password(password)
    db.session.add(u)
    db.session.commit()
    token = u.to_token()
    # Returned in the body as well as the cookie: this frontend is on a
    # different site, so the cookie is third-party and privacy-respecting
    # browsers drop it. The client stores this and sends it as a bearer token.
    resp = jsonify({'user': {'id': u.id, 'username': u.username}, 'token': token})
    resp.set_cookie('auth_token', token, **cookie_options())
    return resp


@app.route('/api/auth/login', methods=['POST'])
def api_login():
    retry_after = rate_limited('login')
    if retry_after is not None:
        return jsonify({
            'error': 'too many sign-in attempts, try again shortly',
            'retry_after': retry_after,
        }), 429

    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    u = User.query.filter_by(username=username).first()
    if not u or not u.check_password(password):
        return jsonify({'error': 'invalid credentials'}), 401
    clear_rate_limit('login')
    token = u.to_token()
    # Returned in the body as well as the cookie: this frontend is on a
    # different site, so the cookie is third-party and privacy-respecting
    # browsers drop it. The client stores this and sends it as a bearer token.
    resp = jsonify({'user': {'id': u.id, 'username': u.username}, 'token': token})
    resp.set_cookie('auth_token', token, **cookie_options())
    return resp


def guest_display_name(session_id):
    """Whatever the guest called themselves, with a hex discriminator on the
    end so two people picking the same name stay tellable apart."""
    profile = db.session.get(GuestProfile, session_id) if session_id else None
    if profile:
        return profile.display_name
    return f'Guest#{session_id[-6:]}' if session_id else 'Guest#anon'


def clean_room_name(raw):
    """Room names are shown to strangers when browsing, so keep them short
    and printable."""
    cleaned = re.sub(r"[^A-Za-z0-9 _'-]", "", (raw or "")).strip()[:40]
    return cleaned or None


def clean_display_name(raw):
    """Names are shown to strangers, so keep them short and printable."""
    cleaned = re.sub(r'[^A-Za-z0-9 _-]', '', (raw or '')).strip()[:20]
    return cleaned or None


@app.route('/api/auth/guest', methods=['POST'])
def api_guest():
    session_id = f'guest_{uuid.uuid4().hex[:12]}'
    chosen = clean_display_name((request.get_json(silent=True) or {}).get('display_name'))
    display = f'{chosen}#{session_id[-6:]}' if chosen else f'Guest#{session_id[-6:]}'
    db.session.add(GuestProfile(session_id=session_id, display_name=display))
    db.session.commit()
    resp = jsonify({'guest_session_id': session_id, 'display_name': display})
    options = cookie_options()
    options['max_age'] = 3600
    resp.set_cookie('guest_session', session_id, **options)
    return resp


@app.route('/api/auth/me', methods=['GET'])
@optional_auth
def api_me():
    user = getattr(request, 'user', None)
    if user:
        return jsonify({'user': {'id': user.id, 'username': user.username, 'email': user.email, 'preferences': user.prefs(), 'rating': user.rating, 'lat': user.lat, 'lng': user.lng}})
    guest_sess = guest_session_id()
    if guest_sess:
        return jsonify({'guest': True, 'guest_session_id': guest_sess})
    return jsonify({'user': None})


@app.route('/api/auth/logout', methods=['POST'])
def api_logout():
    resp = jsonify({'ok': True})
    resp.set_cookie('auth_token', '', expires=0)
    resp.set_cookie('guest_session', '', expires=0)
    return resp


@app.route('/api/auth/preferences', methods=['PUT'])
@auth_required
def api_prefs():
    data = request.get_json() or {}
    user = request.user
    prefs = user.prefs()
    prefs.update(data)
    user.set_prefs(prefs)
    db.session.commit()
    return jsonify({'preferences': prefs})


@app.route('/api/auth/location', methods=['PUT'])
@auth_required
def api_location():
    data = request.get_json() or {}
    lat = data.get('lat')
    lng = data.get('lng')
    if lat is None or lng is None:
        return jsonify({'error': 'lat/lng required'}), 400
    request.user.lat = float(lat)
    request.user.lng = float(lng)
    db.session.commit()
    return jsonify({'lat': request.user.lat, 'lng': request.user.lng})


# -------------------------
# Games API
# -------------------------
@app.route('/api/games', methods=['GET'])
def api_games():
    # The catalog in DEFAULT_GAMES is the source of truth; the table is only
    # storage. Filtering on the stored category alone let a row from an older
    # build keep showing up after the catalog moved on, so match on slug.
    offered = [spec['slug'] for spec in DEFAULT_GAMES]
    games = Game.query.filter(Game.slug.in_(offered)).all()
    order = {slug: i for i, slug in enumerate(offered)}
    games.sort(key=lambda g: order.get(g.slug, len(order)))
    return jsonify([{
        'id': g.id,
        'slug': g.slug,
        'name': g.name,
        'max_players': g.max_players,
        'is_1v1': g.is_1v1,
        'default_time_sec': g.default_time_sec,
        'category': g.category,
    } for g in games])


# -------------------------
# Matchmaking / Rooms API
# -------------------------
@app.route('/api/matches/quick', methods=['POST'])
@guest_or_auth
def api_quick_match():
    data = request.get_json() or {}
    game_slug = data.get('game_slug')
    game = Game.query.filter_by(slug=game_slug).first_or_404()
    if not game.is_1v1:
        return jsonify({'error': 'quick match only for 1v1 games'}), 400

    guest_session = guest_session_id()
    identity_filter = (
        MatchPlayer.user_id == request.user.id
        if request.user else MatchPlayer.guest_session_id == guest_session
    )
    # Someone who queued and closed their tab leaves a 'waiting' match behind
    # forever. Handing that to the next player puts them in a room with a ghost
    # that can never arrive, so only consider recently queued matches.
    fresh_cutoff = datetime.utcnow() - timedelta(minutes=QUEUE_TIMEOUT_MINUTES)

    with MATCHMAKING_LOCK:
        # A match you are already in wins, whether it is still filling or has
        # already started. Returning a started match matters: a client that
        # missed the match_start broadcast recovers just by asking again.
        existing = (
            Match.query.join(MatchPlayer)
            .filter(
                identity_filter,
                Match.game_id == game.id,
                or_(
                    and_(Match.status == 'waiting', Match.created_at >= fresh_cutoff),
                    Match.status == 'active',
                ),
            )
            .order_by(Match.id.desc())
            .first()
        )

        if existing is not None:
            match = existing
            # Someone returning after a disconnect is present again.
            for player in match.players:
                is_me = (
                    player.user_id == request.user.id if request.user
                    else player.guest_session_id == guest_session
                )
                if is_me and player.left_at is not None:
                    player.left_at = None
            db.session.commit()
        else:
            candidates = Match.query.filter_by(game_id=game.id, status='waiting').filter(
                Match.created_at >= fresh_cutoff,
                ~Match.players.any(identity_filter),
            ).all()
            # Only rooms with space, and never one everybody already left.
            candidates = [c for c in candidates if 0 < len(present_players(c)) < game.max_players]

            # Competitive pairing feeds the ladder, so prefer an opponent near
            # your rating rather than whoever queued first. Guests have no
            # rating, so they sit at the default and pair with each other.
            waiting = None
            if candidates:
                if game.category == COMPETITIVE:
                    my_rating = request.user.rating if request.user else DEFAULT_RATING

                    def rating_gap(candidate):
                        ratings = [
                            p.user.rating for p in present_players(candidate)
                            if p.user is not None and p.user.rating is not None
                        ]
                        opponent = sum(ratings) / len(ratings) if ratings else DEFAULT_RATING
                        return abs(opponent - my_rating)

                    waiting = min(candidates, key=rating_gap)
                else:
                    waiting = candidates[0]

            if waiting is not None:
                match = waiting
            else:
                match = Match(
                    game_id=game.id,
                    room_code=gen_room_code(),
                    host_user_id=request.user.id if request.user else None,
                    status='waiting',
                )
                db.session.add(match)
                db.session.flush()

            db.session.add(MatchPlayer(
                match_id=match.id,
                user_id=request.user.id if request.user else None,
                guest_session_id=guest_session if not request.user else None,
                display_name=request.user.username if request.user else guest_display_name(guest_session or 'anon'),
            ))
            db.session.commit()

        # Both paths end here, so a complete match always starts.
        start_if_ready(match, game)

    return jsonify({
        'match_id': match.id,
        'room_code': match.room_code,
        'game': game.slug,
        'status': match.status,
        'players': [{'display_name': p.display_name} for p in present_players(match)],
    })


def room_occupants(room):
    match = Match.query.filter_by(room_code=room.code).first()
    if match is None:
        return []
    return present_players(match)


@app.route('/api/rooms', methods=['GET'])
def api_list_rooms():
    purge_abandoned_rooms()
    rooms = Room.query.filter_by(status='open').join(Game).filter(Game.category == SOCIAL).all()
    out = []
    for r in rooms:
        occupants = room_occupants(r)
        out.append({
            'code': r.code,
            'name': r.name or f'{r.game.name} {r.code[:4]}',
            'game': r.game.slug,
            'game_name': r.game.name,
            'settings': json.loads(r.settings_json or '{}'),
            'player_count': len(occupants),
            'max_players': r.game.max_players,
            'players': [{'display_name': p.display_name} for p in occupants],
        })
    return jsonify(out)


@app.route('/api/rooms', methods=['POST'])
# Social channels are the front door and most arrivals are guests, so opening
# one must not demand an account. Competitive is refused below regardless.
@guest_or_auth
def api_create_room():
    data = request.get_json() or {}
    game_slug = data.get('game_slug')
    game = Game.query.filter_by(slug=game_slug).first_or_404()
    # Competitive play is matchmaking only: a private code would let friends
    # arrange ranked results between themselves.
    if game.category == COMPETITIVE:
        return jsonify({'error': 'competitive games use matchmaking, not room codes'}), 400
    settings = data.get('settings', {})
    room = Room(
        code=gen_room_code(),
        game_id=game.id,
        host_user_id=request.user.id if request.user else None,
        settings_json=json.dumps(settings),
        status='open',
        name=clean_room_name(data.get('name')),
    )
    db.session.add(room)
    db.session.commit()
    return jsonify({
        'code': room.code,
        'name': room.name or f'{game.name} {room.code[:4]}',
        'game': game.slug,
        'settings': settings,
    })


@app.route('/api/rooms/<code>/join', methods=['POST'])
@guest_or_auth
def api_join_room(code):
    room = Room.query.filter_by(code=code).first_or_404()
    if room.status != 'open':
        return jsonify({'error': 'room not open'}), 400
    if room.game.category == COMPETITIVE:
        return jsonify({'error': 'competitive games use matchmaking, not room codes'}), 400
    display = request.user.username if request.user else guest_display_name(guest_session_id() or 'anon')

    # A room has exactly one match, reused by everyone who joins. Match.room_code
    # is unique, so minting a fresh Match per join made the second player fail
    # with an IntegrityError and left the first alone in the room.
    match = Match.query.filter_by(room_code=room.code).first()
    if match is None:
        match = Match(
            game_id=room.game_id,
            room_code=room.code,
            host_user_id=room.host_user_id,
            settings_json=room.settings_json,
            status='active',
            started_at=datetime.utcnow(),
        )
        db.session.add(match)
        db.session.commit()

    guest_session = guest_session_id() if not request.user else None
    identity_filter = (
        MatchPlayer.user_id == request.user.id
        if request.user else MatchPlayer.guest_session_id == guest_session
    )
    # Rejoining after a reconnect must not add the same person twice.
    existing = MatchPlayer.query.filter(
        MatchPlayer.match_id == match.id, identity_filter
    ).first()
    if existing is None:
        # A 1:1 room is only 1:1 if a third person is turned away.
        present = [p for p in match.players if p.left_at is None]
        if len(present) >= room.game.max_players:
            return jsonify({'error': 'room is full'}), 400
        db.session.add(MatchPlayer(
            match_id=match.id,
            user_id=request.user.id if request.user else None,
            guest_session_id=guest_session,
            display_name=display,
        ))
        db.session.commit()

    # Joining is itself being in the room. Without this the reaper saw a room
    # no socket had ever been in and deleted it out from under the person who
    # had just made it, so a shared code died before anyone could use it.
    touch_match_presence(match.id)

    return jsonify({
        'match_id': match.id,
        'room_code': room.code,
        'game': room.game.slug,
        'name': room.name or f'{room.game.name} {room.code[:4]}',
        'game_name': room.game.name,
    })


# -------------------------
# Match / Gameplay API
# -------------------------
@app.route('/api/matches/<int:match_id>/submit', methods=['POST'])
@guest_or_auth
def api_submit_result(match_id):
    match = Match.query.get_or_404(match_id)
    data = request.get_json() or {}
    # Find player
    if request.user:
        mp = MatchPlayer.query.filter_by(match_id=match_id, user_id=request.user.id).first()
    else:
        gs = guest_session_id()
        mp = MatchPlayer.query.filter_by(match_id=match_id, guest_session_id=gs).first()
    if not mp:
        return jsonify({'error': 'not a player in this match'}), 403

    # A result decides the ladder, so it cannot be taken on trust: the counting
    # runs in the player's own browser and anything there can be edited.
    if mp.result_json:
        return jsonify({'error': 'a result was already submitted for this match'}), 400

    error = validate_result(match.game, data)
    if error:
        return jsonify({'error': error}), 400

    mp.result_json = json.dumps(data)
    db.session.commit()

    # Update leaderboard for 1v1 games with scores
    game = match.game
    if game.is_1v1 and request.user:
        score = data.get('score')
        if score is not None:
            lb = Leaderboard.query.filter_by(game_id=game.id, user_id=request.user.id).first()
            if not lb or score > lb.best_score:
                if not lb:
                    lb = Leaderboard(game_id=game.id, user_id=request.user.id, best_score=score)
                    db.session.add(lb)
                else:
                    lb.best_score = score
                    lb.achieved_at = datetime.utcnow()
                db.session.commit()

    # Check if all players submitted
    all_submitted = all(p.result_json for p in match.players)
    if all_submitted:
        match.status = 'finished'
        match.finished_at = datetime.utcnow()
        db.session.commit()
        socketio.emit('match_finished', {'match_id': match.id, 'results': [{'name': p.display_name, 'result': json.loads(p.result_json) if p.result_json else {}} for p in match.players]}, to=f'match_{match.id}')

    return jsonify({'ok': True})


# -------------------------
# Judged battles: the audience decides
# -------------------------

# Games with no objective score. A machine can measure whether someone was on
# beat; it cannot measure whether the bar was good, so it does not get to say
# who won.
JUDGED_GAMES = {'rapbattle', 'looks'}


def vote_tally(match):
    """Votes per player, plus every player so a zero still shows up."""
    counts = {p.id: 0 for p in match.players}
    for vote in BattleVote.query.filter_by(match_id=match.id).all():
        if vote.for_player_id in counts:
            counts[vote.for_player_id] += 1
    return [
        {
            'player_id': player.id,
            'display_name': player.display_name,
            'votes': counts[player.id],
        }
        for player in match.players
    ]


def voter_filter(match_id):
    return and_(
        BattleVote.match_id == match_id,
        BattleVote.voter_user_id == request.user.id
        if request.user
        else BattleVote.voter_guest_session == guest_session_id(),
    )


@app.route('/api/matches/<int:match_id>/votes', methods=['GET'])
@guest_or_auth
def api_battle_votes(match_id):
    match = Match.query.get_or_404(match_id)
    mine = BattleVote.query.filter(voter_filter(match_id)).first()
    return jsonify({
        'match_id': match.id,
        'tally': vote_tally(match),
        'my_vote': mine.for_player_id if mine else None,
    })


@app.route('/api/matches/<int:match_id>/vote', methods=['POST'])
@guest_or_auth
def api_battle_vote(match_id):
    match = Match.query.get_or_404(match_id)
    if match.game is None or match.game.slug not in JUDGED_GAMES:
        return jsonify({'error': 'this game is not decided by votes'}), 400

    data = request.get_json() or {}
    target = MatchPlayer.query.filter_by(
        id=data.get('for_player_id'), match_id=match_id
    ).first()
    if target is None:
        return jsonify({'error': 'no such player in this battle'}), 400

    # You cannot vote for yourself, which is the whole reason a vote means
    # anything. Both competitors are in the room and can vote for the other.
    is_me = (
        target.user_id == request.user.id
        if request.user
        else target.guest_session_id == guest_session_id()
    )
    if is_me:
        return jsonify({'error': 'you cannot vote for yourself'}), 400

    existing = BattleVote.query.filter(voter_filter(match_id)).first()
    if existing is not None:
        # Changing your mind is fine, voting twice is not.
        existing.for_player_id = target.id
    else:
        db.session.add(BattleVote(
            match_id=match_id,
            voter_user_id=request.user.id if request.user else None,
            voter_guest_session=None if request.user else guest_session_id(),
            for_player_id=target.id,
        ))
    db.session.commit()

    tally = vote_tally(match)
    socketio.emit('vote_update', {'match_id': match.id, 'tally': tally}, to=f'match_{match.id}')
    return jsonify({'match_id': match.id, 'tally': tally, 'my_vote': target.id})


@app.route('/api/leaderboard/<slug>', methods=['GET'])
def api_leaderboard(slug):
    game = Game.query.filter_by(slug=slug).first_or_404()
    lbs = Leaderboard.query.filter_by(game_id=game.id).order_by(Leaderboard.best_score.desc()).limit(100).all()
    return jsonify([{'rank': i+1, 'username': lb.user.username, 'score': lb.best_score, 'achieved_at': lb.achieved_at.isoformat()} for i, lb in enumerate(lbs)])


# -------------------------
# SocketIO Events
# -------------------------
# Identity of each connected socket, captured from the handshake. Cookies are
# third-party on this deployment and are dropped by privacy-respecting
# browsers, so the client also passes credentials in the Socket.IO auth
# payload. Keyed by session id and cleared on disconnect.
SOCKET_IDENTITIES = {}


@socketio.on('connect')
def on_socket_connect(auth=None):
    creds = auth if isinstance(auth, dict) else {}
    token = creds.get('token') or request.cookies.get('auth_token')
    guest = creds.get('guest_session') or request.cookies.get('guest_session')
    user = User.from_token(token) if token else None
    SOCKET_IDENTITIES[request.sid] = {
        'user_id': user.id if user else None,
        'guest_session': None if user else guest,
    }


@socketio.on('disconnect')
def on_socket_disconnect(*args):
    identity = SOCKET_IDENTITIES.pop(request.sid, None) or {}
    for match_id in list(identity.get('matches', ())):
        match = db.session.get(Match, match_id)
        # A socket drops for all sorts of reasons that are not a decision to
        # leave: Socket.IO reconnects on any blip, a backgrounded tab is cut
        # off, the container scales. Treating that as leaving pulled players
        # out of their own queue, so the next arrival found an empty room and
        # both sat on Searching. A queue that really was abandoned is caught by
        # QUEUE_TIMEOUT_MINUTES instead.
        if match is None or match.status == 'waiting':
            continue
        _mark_player_left(match_id, identity, reason='disconnected')


def _mark_player_left(match_id, identity, reason='left'):
    user_id = identity.get('user_id')
    guest = identity.get('guest_session')
    query = MatchPlayer.query.filter_by(match_id=match_id)
    player = (
        query.filter_by(user_id=user_id).first() if user_id
        else query.filter_by(guest_session_id=guest).first() if guest
        else None
    )
    if player is None or player.left_at is not None:
        return None
    player.left_at = datetime.utcnow()

    match = db.session.get(Match, match_id)
    if match is not None and match.status == 'active':
        remaining = [p for p in match.players if p.left_at is None]
        if not remaining:
            match.status = 'finished'
            match.finished_at = datetime.utcnow()
        elif match.game is not None and match.game.category == COMPETITIVE:
            # A competitive match cannot be won by outlasting someone's
            # connection, so someone leaving early settles it as a stalemate.
            match.status = 'finished'
            match.finished_at = datetime.utcnow()
            socketio.emit('match_finished', {
                'match_id': match.id,
                'outcome': 'stalemate',
                'reason': reason,
                'results': [{'name': p.display_name, 'result': {}} for p in match.players],
            }, to=f'match_{match.id}')
    db.session.commit()
    return player


def socket_player(match_id):
    identity = SOCKET_IDENTITIES.get(request.sid) or {}
    user_id = identity.get('user_id')
    if user_id:
        return MatchPlayer.query.filter_by(match_id=match_id, user_id=user_id).first()
    guest_session = identity.get('guest_session')
    if guest_session:
        return MatchPlayer.query.filter_by(
            match_id=match_id, guest_session_id=guest_session
        ).first()
    return None


def require_socket_player(match_id):
    player = socket_player(match_id)
    if not player:
        emit('error', {
            'message': 'not a player in this match',
            'code': 'forbidden',
        })
    return player


@socketio.on('join_match')
def on_join_match(data):
    match_id = data.get('match_id') if isinstance(data, dict) else None
    player = require_socket_player(match_id)
    if not player:
        return
    join_room(f'match_{match_id}')
    SOCKET_IDENTITIES.setdefault(request.sid, {}).setdefault('matches', set()).add(match_id)
    touch_match_presence(match_id)
    if player.left_at is not None:
        player.left_at = None  # rejoined
        db.session.commit()
    emit('joined_match', {'match_id': match_id})
    emit('player_joined', {
        'match_id': match_id,
        'player': {'id': player.id, 'display_name': player.display_name},
    }, to=f'match_{match_id}', include_self=False)


@socketio.on('leave_match')
def on_leave_match(data):
    match_id = data.get('match_id') if isinstance(data, dict) else None
    player = require_socket_player(match_id)
    if not player:
        return
    leave_room(f'match_{match_id}')
    identity = SOCKET_IDENTITIES.get(request.sid) or {}
    identity.get('matches', set()).discard(match_id)
    _mark_player_left(match_id, identity, reason='left')
    emit('player_left', {
        'match_id': match_id,
        'player_id': player.id,
    }, to=f'match_{match_id}')


@socketio.on('game_action')
def on_game_action(data):
    match_id = data.get('match_id') if isinstance(data, dict) else None
    if not require_socket_player(match_id):
        return
    emit('game_action', {
        'match_id': match_id,
        'action': data.get('action'),
        'payload': data.get('payload', {}),
        'from': request.sid,
    }, to=f'match_{match_id}', include_self=False)


@socketio.on('signal')
def on_signal(data):
    match_id = data.get('match_id') if isinstance(data, dict) else None
    if not require_socket_player(match_id):
        return
    if data.get('type') not in {'offer', 'answer', 'candidate'}:
        emit('error', {'message': 'invalid signal type', 'code': 'invalid_signal'})
        return
    signal = dict(data)
    signal['from'] = request.sid
    emit('signal', signal, to=f'match_{match_id}', include_self=False)


@socketio.on('chat_message')
def on_chat_message(data):
    match_id = data.get('match_id') if isinstance(data, dict) else None
    player = require_socket_player(match_id)
    if not player:
        return
    text = str(data.get('text', '')).strip()
    if not text or len(text) > 1000:
        emit('error', {'message': 'message must be 1-1000 characters', 'code': 'invalid_message'})
        return
    emit('chat_message', {
        'match_id': match_id,
        'from': player.display_name,
        'text': text,
        'timestamp': datetime.utcnow().isoformat() + 'Z',
    }, to=f'match_{match_id}', include_self=False)


# -------------------------
# Main
# -------------------------
if __name__ == '__main__':
    # Same PORT the container uses, so a local run can stand in for the
    # deployed backend without rebuilding the frontend against a new host.
    socketio.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)), debug=True)