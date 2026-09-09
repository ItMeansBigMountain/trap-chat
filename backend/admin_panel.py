"""Trap Chat — the admin panel.

Django's `/admin` by way of Flask-Admin, which generates the same kind of
model CRUD from the SQLAlchemy models we already have. Building one by hand
would have been weeks of screens that a library gives us for the cost of one
dependency, and none of that work would have been the interesting part.

**Who is an admin is decided by the environment, not by the database.**
`ADMIN_USERNAMES` is a comma-separated list, set by Terraform as a Container
App setting. There is deliberately no `is_admin` column: a flag in the
database is one SQL injection or one careless endpoint away from being set by
somebody else, and the blast radius of a self-promoted admin on an app with
strangers' cameras in it is the whole product. An environment variable can
only be changed through an approved infrastructure apply.

**If `ADMIN_USERNAMES` is empty the panel does not exist at all** -- every
route 404s rather than 403s. A misconfigured deploy should not leave an
unlocked door with a sign on it, and a 404 does not confirm there is anything
there to attack.

Admin sessions are a signed Flask session cookie, separate from the app's JWT.
The two are deliberately not the same credential: a token that leaks from a
phone should not carry admin rights with it, and the panel is server-rendered
so it wants a cookie anyway.
"""

import os
from datetime import datetime, timedelta
from functools import wraps

from flask import (
    Response, abort, flash, redirect, render_template_string, request, session, url_for,
)

# The whole panel is optional. If the dependency is missing the app must still
# boot -- the backend serving matches matters more than the admin screens.
try:
    from flask_admin import Admin, AdminIndexView, expose
    from flask_admin.contrib.sqla import ModelView
    from flask_admin.actions import action
    ADMIN_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised only without the dependency
    ADMIN_AVAILABLE = False


def root_admins():
    """The admins the environment names, which the app itself cannot change.

    This is the root of trust and the lockout recovery: if the grants table
    is emptied, by accident or by somebody who got in, these accounts still
    work and can put it back.
    """
    raw = os.environ.get('ADMIN_USERNAMES', '')
    return {name.strip().lower() for name in raw.split(',') if name.strip()}


# Kept as the old name too: `admin_enabled` reads better beside it and the
# tests speak in these terms.
admin_usernames = root_admins


def admin_enabled():
    return ADMIN_AVAILABLE and bool(root_admins())


# How long an admin session lasts before it has to be re-established. Short on
# purpose: this is a screen that can ban people and delete rows, and it is
# usually left open in a tab.
ADMIN_SESSION_HOURS = 8


# Set by mount_admin, so the session check can ask the database whether a
# grant still stands. Checked on every request rather than trusted from the
# cookie: revoking an admin has to take effect now, not when their session
# happens to expire.
_is_admin = None


def is_admin_username(username):
    """Root admins, plus anyone an admin has granted from the panel."""
    if not username:
        return False
    if username.lower() in root_admins():
        return True
    return bool(_is_admin and _is_admin(username))


def _session_is_live():
    who = session.get('admin_user')
    if not is_admin_username(who):
        return False
    started = session.get('admin_since')
    if not started:
        return False
    try:
        began = datetime.fromisoformat(started)
    except (TypeError, ValueError):
        return False
    return datetime.utcnow() - began < timedelta(hours=ADMIN_SESSION_HOURS)


LOGIN_PAGE = """
<!doctype html><meta charset="utf-8"><title>Trap Chat admin</title>
<style>
  body { background:#000; color:#fff; font-family:system-ui,sans-serif;
         display:flex; align-items:center; justify-content:center; height:100vh; margin:0 }
  form { background:#121212; padding:28px; border-radius:10px; width:300px }
  h1 { font-size:18px; margin:0 0 4px }
  p { color:#a1a1a1; font-size:12px; margin:0 0 18px }
  input { width:100%; box-sizing:border-box; margin-bottom:10px; padding:11px;
          background:#000; border:1px solid #2a2a2a; border-radius:6px; color:#fff }
  button { width:100%; padding:12px; background:#CCFF00; color:#000; border:0;
           border-radius:6px; font-weight:800; cursor:pointer }
  .err { color:#FF4757; font-size:12px; margin-bottom:10px }
</style>
<form method="post">
  <h1>Trap Chat admin</h1>
  <p>Staff only. Sessions last {{ hours }} hours.</p>
  {% if error %}<div class="err">{{ error }}</div>{% endif %}
  <input name="username" placeholder="Username" autocomplete="username" autofocus>
  <input name="password" type="password" placeholder="Password" autocomplete="current-password">
  <button type="submit">Sign in</button>
</form>
"""


def mount_admin(app, db, models, *, check_password, rate_limited, clear_rate_limit):
    """Attach the panel, or do nothing at all if it is not configured.

    `check_password(user, raw)` is passed in rather than imported so this
    module never needs to know how hashing works, and the tests can drive it
    without the app module importing itself in a circle.
    """
    if not admin_enabled():
        return False

    User = models['User']
    AdminGrant = models['AdminGrant']

    # Let the module-level session check reach the grants table.
    global _is_admin

    def _granted(username):
        user = User.query.filter_by(username=username).first()
        if user is None:
            return False
        return AdminGrant.query.filter_by(user_id=user.id).first() is not None

    _is_admin = _granted

    # Methods that change something. Anything else is safe to reach from a
    # link and does not need the origin check below.
    UNSAFE = {'POST', 'PUT', 'PATCH', 'DELETE'}

    def same_origin():
        """Did this request start on our own site?

        The second CSRF layer, behind SameSite=Strict on the cookie. Strict is
        the real defence and it is enough on every current browser, but this
        panel can grant admin rights, and a cross-site POST that adds an
        AdminGrant row is total compromise -- so it gets a defence that does
        not depend on the browser honouring a cookie attribute.

        Flask-Admin's actions and delete buttons are ordinary form posts, so
        checking here covers all of them at once. Doing it per form would mean
        remembering, and the cost of forgetting once is the whole product.
        """
        origin = request.headers.get('Origin')
        if origin:
            return origin.rstrip('/') == request.host_url.rstrip('/')
        referer = request.headers.get('Referer')
        if referer:
            return referer.startswith(request.host_url)
        # Neither header. A browser always sends one on a form post, so this
        # is a script -- and a script has no session cookie to abuse anyway.
        return False

    def guard():
        """Every route goes through here. A 404 rather than a 403, because a
        403 tells an attacker the panel exists and is worth attacking."""
        if not admin_enabled():
            abort(404)
        if request.method in UNSAFE and not same_origin():
            abort(403)
        if not _session_is_live():
            return redirect(url_for('admin_login', next=request.path))
        return None

    @app.route('/admin/login', methods=['GET', 'POST'], endpoint='admin_login')
    def admin_login():
        if not admin_enabled():
            abort(404)
        if request.method in UNSAFE and not same_origin():
            # Login CSRF is milder than the rest -- it can only sign somebody
            # in as the attacker -- but the form is on the same door, so it
            # gets the same lock.
            abort(403)
        error = None
        if request.method == 'POST':
            # The same limiter the app's own sign-in uses. A login form that
            # bans people is worth more to guess at than one that does not.
            wait = rate_limited('admin_login')
            if wait is not None:
                error = 'Too many attempts. Try again shortly.'
            else:
                username = (request.form.get('username') or '').strip()
                password = request.form.get('password') or ''
                user = User.query.filter_by(username=username).first()
                ok = (
                    user is not None
                    and is_admin_username(username)
                    and check_password(user, password)
                )
                if ok:
                    session['admin_user'] = user.username
                    session['admin_since'] = datetime.utcnow().isoformat()
                    session.permanent = False
                    clear_rate_limit('admin_login')
                    target = request.args.get('next') or '/admin/'
                    # Only ever back into the panel, never to an absolute URL
                    # somebody appended to the link they sent you.
                    if not target.startswith('/admin'):
                        target = '/admin/'
                    return redirect(target)
                # One message for every failure. Saying "no such user" would
                # turn this into a way to enumerate the staff list.
                error = 'Those details were not accepted.'
        return render_template_string(LOGIN_PAGE, error=error, hours=ADMIN_SESSION_HOURS)

    @app.route('/admin/logout', endpoint='admin_logout')
    def admin_logout():
        session.pop('admin_user', None)
        session.pop('admin_since', None)
        return redirect(url_for('admin_login'))

    class Guarded(ModelView):
        """Everything an admin can see, behind the same door."""

        page_size = 50
        can_view_details = True
        can_export = True

        def is_accessible(self):
            return _session_is_live()

        def inaccessible_callback(self, name, **kwargs):
            return redirect(url_for('admin_login', next=request.path))

    class UserView(Guarded):
        column_list = ('id', 'username', 'email', 'rating', 'created_at')
        column_searchable_list = ('username', 'email')
        column_filters = ('rating', 'created_at')
        column_default_sort = ('id', True)
        # A password hash on a list page is a hash in a screenshot.
        column_exclude_list = ('password_hash', 'preferences_json')
        form_excluded_columns = ('password_hash',)

        @action('ban', 'Ban', 'Ban these accounts and sign them out everywhere?')
        def action_ban(self, ids):
            self._set_banned(ids, True)

        @action('unban', 'Unban', 'Restore these accounts?')
        def action_unban(self, ids):
            self._set_banned(ids, False)

        @action('signout', 'Force sign-out', 'End every session for these accounts?')
        def action_signout(self, ids):
            count = 0
            for user in User.query.filter(User.id.in_(ids)).all():
                user.revoke_tokens()
                count += 1
            db.session.commit()
            flash(f'Signed out {count} account(s) everywhere.')

        def _set_banned(self, ids, banned):
            count = 0
            for user in User.query.filter(User.id.in_(ids)).all():
                prefs = user.prefs()
                prefs['banned'] = banned
                user.set_prefs(prefs)
                # Banning has to end the sessions too, or the ban only takes
                # effect the next time they happen to sign in.
                if banned:
                    user.revoke_tokens()
                count += 1
            db.session.commit()
            flash(f'{"Banned" if banned else "Unbanned"} {count} account(s).')

    class ReportView(Guarded):
        """The moderation queue. Reports were being recorded and nothing read
        them, which is the same as not having reporting at all."""

        column_list = ('id', 'created_at', 'reason', 'reported_name',
                       'reported_user_id', 'reported_guest', 'match_id')
        column_filters = ('reason', 'created_at')
        column_default_sort = ('created_at', True)
        can_create = False

    class MatchView(Guarded):
        column_list = ('id', 'room_code', 'game_id', 'status', 'created_at', 'finished_at')
        column_filters = ('status', 'created_at')
        column_default_sort = ('id', True)
        can_create = False

        @action('close', 'Close', 'End these matches now?')
        def action_close(self, ids):
            Match = models['Match']
            count = 0
            for match in Match.query.filter(Match.id.in_(ids)).all():
                if match.status != 'finished':
                    match.status = 'finished'
                    match.finished_at = datetime.utcnow()
                    count += 1
            db.session.commit()
            flash(f'Closed {count} match(es).')

    class RoomView(Guarded):
        column_list = ('id', 'code', 'name', 'game_id', 'status', 'created_at')
        column_searchable_list = ('code', 'name')
        column_filters = ('status', 'created_at')
        column_default_sort = ('id', True)
        can_create = False

    class LeaderboardView(Guarded):
        """Deletable on purpose. Test rows land on the real board and the only
        other way to remove one is downloading and re-uploading the whole
        SQLite file, which rolls back whatever happened meanwhile."""

        column_list = ('id', 'user_id', 'game_id', 'best_score', 'achieved_at')
        column_filters = ('game_id', 'achieved_at')
        column_default_sort = ('best_score', True)
        can_create = False

    class AdminGrantView(Guarded):
        """Making a colleague an admin, without a deploy.

        The one thing this cannot do is remove a root admin: those come from
        the environment and have no row here. That is deliberate -- it is the
        way back in if this table is emptied.
        """

        column_list = ('id', 'user', 'granted_by', 'created_at')
        column_labels = {'user': 'Account'}
        column_default_sort = ('id', True)
        form_columns = ('user',)

        def on_model_change(self, form, model, is_created):
            if is_created:
                # Recorded from the session rather than the form, so it says
                # who actually did it and cannot be typed in as somebody else.
                model.granted_by = session.get('admin_user')

        def create_form(self, obj=None):
            form = super().create_form(obj)
            self._explain(form)
            return form

        def edit_form(self, obj=None):
            form = super().edit_form(obj)
            self._explain(form)
            return form

        @staticmethod
        def _explain(form):
            if hasattr(form, 'user') and form.user is not None:
                form.user.description = (
                    'The account becomes an admin immediately and can sign in '
                    'at /admin/login with their own password. Root admins from '
                    'ADMIN_USERNAMES are not listed here and cannot be removed '
                    'from this screen.'
                )

    class ReadOnly(Guarded):
        can_create = False
        can_edit = False
        can_delete = False

    class EventView(ReadOnly):
        column_list = ('id', 'name', 'viewer', 'at')
        column_filters = ('name', 'viewer', 'at')
        column_default_sort = ('id', True)

    class Home(AdminIndexView):
        @expose('/')
        def index(self):
            if not _session_is_live():
                return redirect(url_for('admin_login', next='/admin/'))
            return self.render('admin/index.html')

        def is_accessible(self):
            return _session_is_live()

        def inaccessible_callback(self, name, **kwargs):
            return redirect(url_for('admin_login', next=request.path))

    # Flask-Admin 2.x picks its own theme; the 1.x `template_mode` argument
    # is gone and passing it is a TypeError.
    admin = Admin(app, name='Trap Chat', index_view=Home(url='/admin'))
    admin.add_view(UserView(User, db.session, name='Accounts'))
    admin.add_view(AdminGrantView(AdminGrant, db.session, name='Admins'))
    admin.add_view(ReportView(models['Report'], db.session, name='Reports'))
    admin.add_view(Guarded(models['Block'], db.session, name='Blocks'))
    admin.add_view(MatchView(models['Match'], db.session, name='Matches'))
    admin.add_view(RoomView(models['Room'], db.session, name='Rooms'))
    admin.add_view(LeaderboardView(models['Leaderboard'], db.session, name='Leaderboard'))
    admin.add_view(EventView(models['Event'], db.session, name='Events'))

    # Belt and braces. Flask-Admin gates each view, but a future view added
    # without a guard would otherwise be open, and this is not a place to rely
    # on everybody remembering.
    @app.before_request
    def _gate_admin():
        path = request.path or ''
        if not path.startswith('/admin'):
            return None
        if path.startswith('/admin/login') or path.startswith('/admin/logout'):
            return None
        if path.startswith('/admin/static'):
            return None
        return guard()

    return True
