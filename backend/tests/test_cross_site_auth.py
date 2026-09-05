"""The frontend and backend are on different sites (Static Web Apps vs
Container Apps), so every auth cookie is a third-party cookie. Chrome
incognito blocks those outright, Safari and Firefox restrict them, and Chrome
is retiring them generally. Auth therefore cannot depend on cookies alone: it
must also work from headers.
"""

import importlib
import os


def load_app(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    module = importlib.import_module("app")
    return module.app


def test_register_returns_a_token_the_client_can_store(tmp_path):
    app = load_app(tmp_path)
    response = app.test_client().post(
        "/api/auth/register",
        json={"username": "bearer_new", "password": "Str0ng-Pass!1"},
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    assert response.get_json().get("token"), "no token in body; a cookie-blocked client has nothing to send"


def test_login_token_authenticates_without_any_cookie(tmp_path):
    app = load_app(tmp_path)
    signup = app.test_client()
    signup.post("/api/auth/register", json={"username": "bearer_user", "password": "Str0ng-Pass!1"})

    login = app.test_client().post(
        "/api/auth/login", json={"username": "bearer_user", "password": "Str0ng-Pass!1"}
    )
    token = login.get_json().get("token")
    assert token, "login must return a token for cookie-blocked clients"

    # A completely separate client with no cookie jar at all.
    clean = app.test_client()
    me = clean.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert me.status_code == 200, me.get_data(as_text=True)
    assert me.get_json()["user"]["username"] == "bearer_user"


def test_guest_session_header_works_without_a_cookie(tmp_path):
    """A guest in incognito gets a session id back but cannot store the cookie,
    so it has to be accepted from a header or matchmaking returns 401."""
    app = load_app(tmp_path)
    created = app.test_client().post("/api/auth/guest")
    assert created.status_code == 200
    session_id = created.get_json()["guest_session_id"]

    clean = app.test_client()
    response = clean.post(
        "/api/matches/quick",
        json={"game_slug": "rapbattle"},
        headers={"X-Guest-Session": session_id},
    )

    assert response.status_code == 200, response.get_data(as_text=True)
    assert response.get_json()["match_id"]
