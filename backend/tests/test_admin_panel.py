"""The admin panel, and mostly the lock on its door.

A staff panel on a public app with strangers' cameras in it is the highest
value target the product has. Almost everything worth pinning here is about
who cannot get in, not what an admin can do once they are.

The rules:

  - Admin rights come from `ADMIN_USERNAMES` in the environment, never from
    the database. A flag in a row is one careless endpoint away from being
    set by somebody else.
  - With no `ADMIN_USERNAMES` the panel does not exist. Not 403 -- 404. A
    misconfigured deploy should not leave an unlocked door with a sign on it.
  - An ordinary account, however valid its password, is not an admin.
  - The panel failing to mount must never take the backend down with it.
"""

import importlib
import os
import sys

import pytest


def load(tmp_path, admins=None):
    """Import the app with a given admin list.

    The module is cached across the suite and reads ADMIN_USERNAMES at import,
    so it has to be evicted for the setting to take effect. Everything else in
    the suite re-imports the same cached module afterwards, which is fine: the
    database path is unchanged.
    """
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    if admins is None:
        os.environ.pop("ADMIN_USERNAMES", None)
    else:
        os.environ["ADMIN_USERNAMES"] = admins
    sys.modules.pop("app", None)
    sys.modules.pop("admin_panel", None)
    return importlib.import_module("app")


@pytest.fixture(autouse=True)
def _restore_module(tmp_path):
    """Put the shared module back as the rest of the suite expects it."""
    yield
    os.environ.pop("ADMIN_USERNAMES", None)
    sys.modules.pop("app", None)
    sys.modules.pop("admin_panel", None)
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    importlib.import_module("app")


def register(module, username, password="Str0ng-Pass!1"):
    client = module.app.test_client()
    response = client.post(
        "/api/auth/register", json={"username": username, "password": password}
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    return client


# The Flask test client's own host. Every real browser sends this on a form
# post; the panel refuses writes without it, which is the CSRF defence.
OURS = "http://localhost"


def sign_in_to_admin(module, username, password="Str0ng-Pass!1", origin=OURS):
    client = module.app.test_client()
    headers = {"Origin": origin} if origin else {}
    return client, client.post(
        "/admin/login",
        data={"username": username, "password": password},
        headers=headers,
        follow_redirects=False,
    )


def test_without_a_configured_admin_the_panel_does_not_exist(tmp_path):
    """404, not 403. A 403 confirms there is something there to attack."""
    module = load(tmp_path, admins=None)
    assert module.ADMIN_MOUNTED is False
    client = module.app.test_client()
    assert client.get("/admin/").status_code == 404
    assert client.get("/admin/login").status_code == 404


def test_the_app_still_works_with_no_panel(tmp_path):
    """The backend serving matches matters more than the staff tool."""
    module = load(tmp_path, admins=None)
    assert module.app.test_client().get("/api/health").status_code == 200


def test_a_configured_admin_can_sign_in(tmp_path):
    module = load(tmp_path, admins="boss")
    register(module, "boss")

    client, response = sign_in_to_admin(module, "boss")
    assert response.status_code == 302, response.get_data(as_text=True)
    assert client.get("/admin/").status_code == 200


def test_an_ordinary_account_cannot(tmp_path):
    """A correct password is not the same as being staff."""
    module = load(tmp_path, admins="boss")
    register(module, "boss")
    register(module, "nobody")

    client, response = sign_in_to_admin(module, "nobody")
    assert response.status_code == 200, "an ordinary account was let in"
    assert b"not accepted" in response.data
    assert client.get("/admin/", follow_redirects=False).status_code == 302


def test_a_wrong_password_is_refused(tmp_path):
    module = load(tmp_path, admins="boss")
    register(module, "boss")

    _, response = sign_in_to_admin(module, "boss", password="guessing")
    assert b"not accepted" in response.data


def test_the_failure_message_does_not_say_which_part_was_wrong(tmp_path):
    """Otherwise the form is a way to enumerate the staff list."""
    module = load(tmp_path, admins="boss")
    register(module, "boss")
    register(module, "nobody")

    _, wrong_user = sign_in_to_admin(module, "nobody")
    _, wrong_pass = sign_in_to_admin(module, "boss", password="guessing")
    assert wrong_user.data == wrong_pass.data


# Flask-Admin names a view's URL after the model, not the label we give it.
# An earlier version of this test listed /admin/accounts/, which does not
# exist -- so it passed on a 404 and proved nothing about the guard.
ADMIN_VIEWS = (
    "/admin/", "/admin/user/", "/admin/admingrant/", "/admin/report/",
    "/admin/block/", "/admin/match/", "/admin/room/", "/admin/leaderboard/",
    "/admin/event/",
)


def test_every_model_view_is_behind_the_door(tmp_path):
    """The guard is a before_request as well as per-view, so a view added
    later without its own check is still covered."""
    module = load(tmp_path, admins="boss")
    client = module.app.test_client()
    for path in ADMIN_VIEWS:
        status = client.get(path, follow_redirects=False).status_code
        assert status == 302, f"{path} was reachable without signing in ({status})"


def test_every_model_view_opens_once_you_are_in(tmp_path):
    """The other half. A guard that refuses everybody is easy."""
    module = load(tmp_path, admins="boss")
    register(module, "boss")
    client, _ = sign_in_to_admin(module, "boss")
    for path in ADMIN_VIEWS:
        assert client.get(path).status_code == 200, f"{path} did not render"


def test_a_password_hash_is_not_on_the_accounts_page(tmp_path):
    """It would be a hash in every screenshot of the admin panel."""
    module = load(tmp_path, admins="boss")
    register(module, "boss")
    client, _ = sign_in_to_admin(module, "boss")
    assert b"password_hash" not in client.get("/admin/user/").data


def test_signing_out_closes_the_session(tmp_path):
    module = load(tmp_path, admins="boss")
    register(module, "boss")
    client, _ = sign_in_to_admin(module, "boss")
    assert client.get("/admin/").status_code == 200

    client.get("/admin/logout")
    assert client.get("/admin/", follow_redirects=False).status_code == 302


def test_a_banned_account_cannot_sign_in(tmp_path):
    """What the ban action is for."""
    module = load(tmp_path, admins="boss")
    register(module, "wrongun")

    with module.app.app_context():
        user = module.User.query.filter_by(username="wrongun").first()
        prefs = user.prefs()
        prefs["banned"] = True
        user.set_prefs(prefs)
        module.db.session.commit()

    response = module.app.test_client().post(
        "/api/auth/login", json={"username": "wrongun", "password": "Str0ng-Pass!1"}
    )
    assert response.status_code == 403
    assert "suspended" in response.get_json()["error"]


def test_a_ban_ends_the_session_they_are_already_in(tmp_path):
    """A ban that only takes effect at the next sign-in is no ban at all: a
    banned person has no reason to sign in again."""
    module = load(tmp_path, admins="boss")
    client = register(module, "stillhere")
    assert client.get("/api/auth/me").get_json()["user"]["username"] == "stillhere"

    with module.app.app_context():
        user = module.User.query.filter_by(username="stillhere").first()
        prefs = user.prefs()
        prefs["banned"] = True
        user.set_prefs(prefs)
        module.db.session.commit()

    assert client.get("/api/auth/me").get_json().get("user") is None


def test_unbanning_lets_them_back(tmp_path):
    module = load(tmp_path, admins="boss")
    register(module, "forgiven")

    with module.app.app_context():
        user = module.User.query.filter_by(username="forgiven").first()
        for banned in (True, False):
            prefs = user.prefs()
            prefs["banned"] = banned
            user.set_prefs(prefs)
            module.db.session.commit()

    assert module.app.test_client().post(
        "/api/auth/login", json={"username": "forgiven", "password": "Str0ng-Pass!1"}
    ).status_code == 200


# ---------------------------------------------------------------- new admins

def grant(module, username, by="boss"):
    """What the Admins view does when you add a row."""
    with module.app.app_context():
        user = module.User.query.filter_by(username=username).first()
        module.db.session.add(
            module.AdminGrant(user_id=user.id, granted_by=by)
        )
        module.db.session.commit()


def test_an_admin_can_make_another_admin(tmp_path):
    """Adding a colleague should not need a deploy."""
    module = load(tmp_path, admins="boss")
    register(module, "boss")
    register(module, "colleague")

    _, before = sign_in_to_admin(module, "colleague")
    assert b"not accepted" in before.data, "an ungranted account got in"

    grant(module, "colleague")

    client, after = sign_in_to_admin(module, "colleague")
    assert after.status_code == 302, after.get_data(as_text=True)
    assert client.get("/admin/").status_code == 200


def test_revoking_a_grant_takes_effect_at_once(tmp_path):
    """Checked on every request rather than trusted from the cookie, or
    removing an admin would wait for their session to expire."""
    module = load(tmp_path, admins="boss")
    register(module, "boss")
    register(module, "temp")
    grant(module, "temp")

    client, _ = sign_in_to_admin(module, "temp")
    assert client.get("/admin/").status_code == 200

    with module.app.app_context():
        module.AdminGrant.query.delete()
        module.db.session.commit()

    assert client.get("/admin/", follow_redirects=False).status_code == 302


def test_a_root_admin_survives_the_grants_table_being_emptied(tmp_path):
    """The lockout recovery. Root admins come from the environment and have no
    row to delete, so there is always a way back in."""
    module = load(tmp_path, admins="boss")
    register(module, "boss")

    with module.app.app_context():
        module.AdminGrant.query.delete()
        module.db.session.commit()

    client, response = sign_in_to_admin(module, "boss")
    assert response.status_code == 302
    assert client.get("/admin/").status_code == 200


def test_a_grant_records_who_made_it(tmp_path):
    module = load(tmp_path, admins="boss")
    register(module, "boss")
    register(module, "recorded")
    grant(module, "recorded", by="boss")

    with module.app.app_context():
        row = module.AdminGrant.query.first()
        assert row.granted_by == "boss"


# ------------------------------------------------- the self-promotion hole

def test_a_user_cannot_write_arbitrary_preferences(tmp_path):
    """preferences_json holds `banned` and `token_version` beside the owner's
    own settings, and this endpoint used to take whatever JSON it was handed.
    It is the reason admin rights live in their own table and not in there."""
    module = load(tmp_path, admins="boss")
    client = register(module, "sneaky")

    response = client.put("/api/auth/preferences", json={"admin": True, "banned": False})
    assert response.status_code == 400, response.get_data(as_text=True)

    with module.app.app_context():
        prefs = module.User.query.filter_by(username="sneaky").first().prefs()
        assert "admin" not in prefs


def test_a_user_cannot_rewrite_their_own_token_version(tmp_path):
    module = load(tmp_path, admins="boss")
    client = register(module, "versioner")

    assert client.put(
        "/api/auth/preferences", json={"token_version": 99}
    ).status_code == 400


def test_real_settings_still_save(tmp_path):
    """An allowlist that blocks the actual settings would be a worse bug."""
    module = load(tmp_path, admins="boss")
    client = register(module, "settler")

    response = client.put("/api/auth/preferences", json={"theme": "dark", "notifications": False})
    assert response.status_code == 200, response.get_data(as_text=True)
    assert response.get_json()["preferences"]["theme"] == "dark"


def test_the_server_bookkeeping_is_not_handed_back(tmp_path):
    """token_version and the ladder marks share the blob and are not theirs."""
    module = load(tmp_path, admins="boss")
    client = register(module, "peeker")
    client.post("/api/me/catchup")

    prefs = client.get("/api/auth/me").get_json()["user"]["preferences"]
    assert "token_version" not in prefs
    assert "seen_at" not in prefs


# ------------------------------------------------------------------- CSRF

def test_a_write_from_another_site_is_refused(tmp_path):
    """The one that matters most. A cross-site POST that adds an AdminGrant
    row would be total compromise, so a write has to have started here."""
    module = load(tmp_path, admins="boss")
    register(module, "boss")
    client, _ = sign_in_to_admin(module, "boss")
    assert client.get("/admin/").status_code == 200, "setup failed"

    response = client.post(
        "/admin/admingrant/new/",
        data={"user": "1"},
        headers={"Origin": "https://evil.example"},
    )
    assert response.status_code == 403, response.status_code

    with module.app.app_context():
        assert module.AdminGrant.query.count() == 0, "a cross-site post created an admin"


def test_a_write_with_no_origin_at_all_is_refused(tmp_path):
    """A browser always sends one on a form post, so this is a script."""
    module = load(tmp_path, admins="boss")
    register(module, "boss")
    client, _ = sign_in_to_admin(module, "boss")

    assert client.post("/admin/user/action/", data={"action": "ban"}).status_code == 403


def test_signing_in_from_another_site_is_refused(tmp_path):
    module = load(tmp_path, admins="boss")
    register(module, "boss")

    _, response = sign_in_to_admin(module, "boss", origin="https://evil.example")
    assert response.status_code == 403


def test_reading_is_not_blocked_by_the_origin_check(tmp_path):
    """Only writes are checked. Gating reads would break following a link."""
    module = load(tmp_path, admins="boss")
    register(module, "boss")
    client, _ = sign_in_to_admin(module, "boss")

    for path in ADMIN_VIEWS:
        assert client.get(path).status_code == 200, path


def test_the_admin_cookie_cannot_travel_cross_site(tmp_path):
    """SameSite=Strict is the layer the origin check backs up, and it is the
    one that stops the request being made at all."""
    module = load(tmp_path, admins="boss")
    assert module.app.config["SESSION_COOKIE_SAMESITE"] == "Strict"
    assert module.app.config["SESSION_COOKIE_HTTPONLY"] is True
    # Its own name, so it cannot be confused with the app's auth cookie.
    assert module.app.config["SESSION_COOKIE_NAME"] == "trapchat_admin"


# --------------------------------------------- behind a TLS-terminating proxy

def test_signing_in_works_through_a_tls_terminating_proxy(tmp_path):
    """The bug this check shipped with, and the reason it is pinned here.

    Container Apps terminates TLS at its ingress, so inside the container the
    scheme is http while the browser sent Origin: https://... The two never
    matched and every admin form post returned 403 -- the panel was completely
    unusable in production the moment the CSRF check went live.

    Nothing caught it: the Flask test client speaks the same scheme as the app
    so Origin matched exactly, and the deploy check only ever sent GETs. This
    test is the one that would have.
    """
    module = load(tmp_path, admins="boss")
    register(module, "boss")
    client = module.app.test_client()

    response = client.post(
        "/admin/login",
        data={"username": "boss", "password": "Str0ng-Pass!1"},
        headers={
            # Exactly what the browser and the ingress send between them.
            "Origin": "https://trap-chat-api.example.azurecontainerapps.io",
            "X-Forwarded-Proto": "https",
            "X-Forwarded-Host": "trap-chat-api.example.azurecontainerapps.io",
        },
        follow_redirects=False,
    )
    assert response.status_code == 302, response.get_data(as_text=True)
    assert client.get("/admin/").status_code == 200


def test_a_forged_forwarded_host_does_not_open_the_door(tmp_path):
    """The headers are trusted for our own scheme, never to widen who counts
    as us. An Origin that is not the forwarded host is still refused."""
    module = load(tmp_path, admins="boss")
    register(module, "boss")

    response = module.app.test_client().post(
        "/admin/login",
        data={"username": "boss", "password": "Str0ng-Pass!1"},
        headers={
            "Origin": "https://evil.example",
            "X-Forwarded-Proto": "https",
            "X-Forwarded-Host": "trap-chat-api.example.azurecontainerapps.io",
        },
    )
    assert response.status_code == 403


def test_a_proxied_write_inside_the_panel_works(tmp_path):
    """Not just login -- Flask-Admin's own forms post the same way."""
    module = load(tmp_path, admins="boss")
    register(module, "boss")
    register(module, "colleague")
    proxy = {
        "Origin": "https://trap-chat-api.example.azurecontainerapps.io",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "trap-chat-api.example.azurecontainerapps.io",
    }
    client = module.app.test_client()
    client.post("/admin/login", data={"username": "boss", "password": "Str0ng-Pass!1"},
                headers=proxy)

    with module.app.app_context():
        target = module.User.query.filter_by(username="colleague").first().id

    response = client.post("/admin/admingrant/new/", data={"user": str(target)},
                           headers=proxy, follow_redirects=False)
    assert response.status_code != 403, "a legitimate admin write was refused"
