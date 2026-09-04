import os
import json
import uuid
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, request, jsonify, render_template, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
import jwt

# Config
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.environ.get('DATABASE_URL', f'sqlite:///{os.path.join(BASE_DIR, "trapchat.db")}')
SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-change-in-production')
JWT_EXP_HOURS = 24 * 30  # 30 days

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['SQLALCHEMY_DATABASE_URI'] = DB_PATH
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = SECRET_KEY
CORS(app, supports_credentials=True, origins=os.environ.get('FRONTEND_ORIGIN', '*'))

db = SQLAlchemy(app)
bcrypt = Bcrypt(app)
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='eventlet')

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
            return User.query.get(payload['uid'])
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


class Room(db.Model):
    __tablename__ = 'rooms'
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(12), unique=True, nullable=False, index=True)
    game_id = db.Column(db.Integer, db.ForeignKey('games.id'), nullable=False)
    host_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    settings_json = db.Column(db.Text, default='{}')
    status = db.Column(db.String(20), nullable=False, default='open')  # open, locked, in_progress, closed
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    game = db.relationship('Game', backref='rooms')


# -------------------------
# Helpers
# -------------------------
def auth_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        token = request.cookies.get('auth_token')
        if not token:
            return jsonify({'error': 'Unauthorized'}), 401
        user = User.from_token(token)
        if not user:
            return jsonify({'error': 'Invalid token'}), 401
        request.user = user
        return f(*args, **kwargs)
    return wrapper


def optional_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        token = request.cookies.get('auth_token')
        if token:
            user = User.from_token(token)
            if user:
                request.user = user
        return f(*args, **kwargs)
    return wrapper


def guest_or_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        token = request.cookies.get('auth_token')
        if token:
            user = User.from_token(token)
            if user:
                request.user = user
                request.guest = False
                return f(*args, **kwargs)
        # guest
        request.user = None
        request.guest = True
        return f(*args, **kwargs)
    return wrapper


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
    {'slug': 'pushups', 'name': 'Push-Ups', 'max_players': 2, 'is_1v1': True, 'default_time_sec': 60},
    {'slug': 'squats', 'name': 'Squats', 'max_players': 2, 'is_1v1': True, 'default_time_sec': 60},
    {'slug': 'rapbattle', 'name': 'Rap Battle', 'max_players': 2, 'is_1v1': True, 'default_time_sec': 60},
    {'slug': 'symmetry', 'name': 'Facial Symmetry', 'max_players': 2, 'is_1v1': True, 'default_time_sec': 30},
    {'slug': 'mog', 'name': 'Mog (Looksmaxx)', 'max_players': 2, 'is_1v1': True, 'default_time_sec': 30},
    {'slug': 'textchat', 'name': 'Text Chat FFA', 'max_players': 20, 'is_1v1': False, 'default_time_sec': 0},
    {'slug': 'ffa', 'name': 'Generic FFA', 'max_players': 20, 'is_1v1': False, 'default_time_sec': 0},
]

with app.app_context():
    db.create_all()
    for g in DEFAULT_GAMES:
        if not Game.query.filter_by(slug=g['slug']).first():
            db.session.add(Game(**g))
    db.session.commit()


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
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip() or None
    password = data.get('password') or ''
    if not username or not password:
        return jsonify({'error': 'username and password required'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'username taken'}), 400
    if email and User.query.filter_by(email=email).first():
        return jsonify({'error': 'email taken'}), 400
    u = User(username=username, email=email)
    u.set_password(password)
    db.session.add(u)
    db.session.commit()
    token = u.to_token()
    resp = jsonify({'user': {'id': u.id, 'username': u.username}})
    resp.set_cookie('auth_token', token, httponly=True, secure=bool(os.environ.get('VERCEL')), samesite='None' if os.environ.get('VERCEL') else 'Lax', max_age=JWT_EXP_HOURS*3600)
    return resp


@app.route('/api/auth/login', methods=['POST'])
def api_login():
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    u = User.query.filter_by(username=username).first()
    if not u or not u.check_password(password):
        return jsonify({'error': 'invalid credentials'}), 401
    token = u.to_token()
    resp = jsonify({'user': {'id': u.id, 'username': u.username}})
    resp.set_cookie('auth_token', token, httponly=True, secure=bool(os.environ.get('VERCEL')), samesite='None' if os.environ.get('VERCEL') else 'Lax', max_age=JWT_EXP_HOURS*3600)
    return resp


@app.route('/api/auth/guest', methods=['POST'])
def api_guest():
    session_id = f'guest_{uuid.uuid4().hex[:12]}'
    resp = jsonify({'guest_session_id': session_id, 'display_name': f'Guest_{session_id[-4:]}'})
    resp.set_cookie('guest_session', session_id, httponly=True, secure=bool(os.environ.get('VERCEL')), samesite='None' if os.environ.get('VERCEL') else 'Lax', max_age=3600)
    return resp


@app.route('/api/auth/me', methods=['GET'])
@optional_auth
def api_me():
    user = getattr(request, 'user', None)
    if user:
        return jsonify({'user': {'id': user.id, 'username': user.username, 'email': user.email, 'preferences': user.prefs(), 'rating': user.rating, 'lat': user.lat, 'lng': user.lng}})
    guest_sess = request.cookies.get('guest_session')
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
    games = Game.query.all()
    return jsonify([{'id': g.id, 'slug': g.slug, 'name': g.name, 'max_players': g.max_players, 'is_1v1': g.is_1v1, 'default_time_sec': g.default_time_sec} for g in games])


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

    # Find waiting match or create new
    waiting = Match.query.filter_by(game_id=game.id, status='waiting').filter(Match.host_user_id != (request.user.id if request.user else -1)).first()
    if waiting:
        match = waiting
    else:
        match = Match(game_id=game.id, room_code=gen_room_code(), host_user_id=request.user.id if request.user else None, status='waiting')
        db.session.add(match)
        db.session.commit()

    # Add player
    display = request.user.username if request.user else f'Guest_{request.cookies.get("guest_session", "anon")[-4:]}'
    mp = MatchPlayer(match_id=match.id, user_id=request.user.id if request.user else None, guest_session_id=request.cookies.get('guest_session') if not request.user else None, display_name=display)
    db.session.add(mp)
    db.session.commit()

    # If 2 players, start
    if len(match.players) >= 2:
        match.status = 'active'
        match.started_at = datetime.utcnow()
        db.session.commit()
        socketio.emit('match_start', {'match_id': match.id, 'room_code': match.room_code, 'game': game.slug}, to=f'match_{match.id}')

    return jsonify({'match_id': match.id, 'room_code': match.room_code, 'game': game.slug, 'status': match.status, 'players': [p.display_name for p in match.players]})


@app.route('/api/rooms', methods=['GET'])
def api_list_rooms():
    rooms = Room.query.filter_by(status='open').all()
    return jsonify([{'code': r.code, 'game': r.game.slug, 'game_name': r.game.name, 'settings': json.loads(r.settings_json or '{}'), 'player_count': len(r.players) if hasattr(r, 'players') else 0} for r in rooms])


@app.route('/api/rooms', methods=['POST'])
@auth_required
def api_create_room():
    data = request.get_json() or {}
    game_slug = data.get('game_slug')
    game = Game.query.filter_by(slug=game_slug).first_or_404()
    settings = data.get('settings', {})
    room = Room(code=gen_room_code(), game_id=game.id, host_user_id=request.user.id, settings_json=json.dumps(settings), status='open')
    db.session.add(room)
    db.session.commit()
    return jsonify({'code': room.code, 'game': game.slug, 'settings': settings})


@app.route('/api/rooms/<code>/join', methods=['POST'])
@guest_or_auth
def api_join_room(code):
    room = Room.query.filter_by(code=code).first_or_404()
    if room.status != 'open':
        return jsonify({'error': 'room not open'}), 400
    display = request.user.username if request.user else f'Guest_{request.cookies.get("guest_session", "anon")[-4:]}'
    # Create a match for this room
    match = Match(game_id=room.game_id, room_code=room.code, host_user_id=room.host_user_id, settings_json=room.settings_json, status='active', started_at=datetime.utcnow())
    db.session.add(match)
    db.session.commit()
    mp = MatchPlayer(match_id=match.id, user_id=request.user.id if request.user else None, guest_session_id=request.cookies.get('guest_session') if not request.user else None, display_name=display)
    db.session.add(mp)
    db.session.commit()
    return jsonify({'match_id': match.id, 'room_code': room.code, 'game': room.game.slug})


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
        gs = request.cookies.get('guest_session')
        mp = MatchPlayer.query.filter_by(match_id=match_id, guest_session_id=gs).first()
    if not mp:
        return jsonify({'error': 'not a player in this match'}), 403
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


@app.route('/api/leaderboard/<slug>', methods=['GET'])
def api_leaderboard(slug):
    game = Game.query.filter_by(slug=slug).first_or_404()
    lbs = Leaderboard.query.filter_by(game_id=game.id).order_by(Leaderboard.best_score.desc()).limit(100).all()
    return jsonify([{'rank': i+1, 'username': lb.user.username, 'score': lb.best_score, 'achieved_at': lb.achieved_at.isoformat()} for i, lb in enumerate(lbs)])


# -------------------------
# SocketIO Events
# -------------------------
@socketio.on('join_match')
def on_join_match(data):
    match_id = data.get('match_id')
    if match_id:
        join_room(f'match_{match_id}')
        emit('joined_match', {'match_id': match_id})


@socketio.on('leave_match')
def on_leave_match(data):
    match_id = data.get('match_id')
    if match_id:
        leave_room(f'match_{match_id}')


@socketio.on('game_action')
def on_game_action(data):
    match_id = data.get('match_id')
    action = data.get('action')
    payload = data.get('payload', {})
    if match_id:
        emit('game_action', {'action': action, 'payload': payload, 'from': request.sid}, to=f'match_{match_id}', include_self=False)


# -------------------------
# Main
# -------------------------
if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)