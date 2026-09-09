"""Account settings that are worth the name.

There was no way to change a password at all, and signing out only forgot the
token on the device doing it -- the token itself stayed valid for its full 30
days. So a leaked token was good for a month, and the one thing people change
a password *for* did nothing about it.

The rules being pinned here:

  - Changing a password needs the current one. Otherwise anybody holding a
    token can lock the owner out of their own account, turning a leak into a
    theft.
  - Changing it ends every other session, and hands back a working token for
    this one, or it is not a password change.
  - Deleting an account really deletes it, and does not rewrite the record of
    the people who played against them.
"""

import importlib
import os
from datetime import datetime, timedelta

import jwt


def load(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    return importlib.import_module("app")


def register(module, username, password="Str0ng-Pass!1"):
    client = module.app.test_client()
    response = client.post(
        "/api/auth/register", json={"username": username, "password": password}
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    return client, response.get_json()["token"]


def bearer(module, token):
    """A second device, holding a token and nothing else."""
    client = module.app.test_client()
    client.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return client


def signed_in_as(client):
    return (client.get("/api/auth/me").get_json() or {}).get("user")


def test_a_password_can_be_changed(tmp_path):
    module = load(tmp_path)
    client, _ = register(module, "changer")

    response = client.post("/api/auth/password", json={
        "current_password": "Str0ng-Pass!1", "new_password": "An0ther-Pass!2",
    })
    assert response.status_code == 200, response.get_data(as_text=True)

    fresh = module.app.test_client()
    assert fresh.post("/api/auth/login", json={
        "username": "changer", "password": "An0ther-Pass!2",
    }).status_code == 200
    assert fresh.post("/api/auth/login", json={
        "username": "changer", "password": "Str0ng-Pass!1",
    }).status_code == 401, "the old password still works"


def test_changing_a_password_needs_the_current_one(tmp_path):
    """Or a stolen token becomes a stolen account."""
    module = load(tmp_path)
    _, token = register(module, "victim")
    thief = bearer(module, token)

    response = thief.post("/api/auth/password", json={
        "current_password": "guessing", "new_password": "Stolen-Pass!9",
    })
    assert response.status_code == 403, response.get_data(as_text=True)

    fresh = module.app.test_client()
    assert fresh.post("/api/auth/login", json={
        "username": "victim", "password": "Str0ng-Pass!1",
    }).status_code == 200, "the owner was locked out of their own account"


def test_changing_a_password_ends_every_other_session(tmp_path):
    """The whole reason token versioning exists."""
    module = load(tmp_path)
    client, old_token = register(module, "elsewhere")
    other_device = bearer(module, old_token)
    assert signed_in_as(other_device)["username"] == "elsewhere"

    client.post("/api/auth/password", json={
        "current_password": "Str0ng-Pass!1", "new_password": "An0ther-Pass!2",
    })

    assert signed_in_as(other_device) is None, (
        "a session from before the password change is still signed in"
    )


def test_the_session_that_changed_it_keeps_working(tmp_path):
    """Revoking every token includes the one that asked, so a fresh one comes
    back in the body. Without that you sign yourself out by changing it."""
    module = load(tmp_path)
    client, _ = register(module, "keeper")

    token = client.post("/api/auth/password", json={
        "current_password": "Str0ng-Pass!1", "new_password": "An0ther-Pass!2",
    }).get_json()["token"]

    assert signed_in_as(bearer(module, token))["username"] == "keeper"


def test_sign_out_everywhere_drops_other_tokens(tmp_path):
    module = load(tmp_path)
    client, old_token = register(module, "everywhere")
    other_device = bearer(module, old_token)

    kept = client.delete("/api/auth/sessions").get_json()["token"]

    assert signed_in_as(other_device) is None
    assert signed_in_as(bearer(module, kept))["username"] == "everywhere"


def test_a_token_from_before_versioning_still_works(tmp_path):
    """Nobody should be signed out merely by deploying this."""
    module = load(tmp_path)
    register(module, "legacy")

    with module.app.app_context():
        user = module.User.query.filter_by(username="legacy").first()
        old_style = jwt.encode(
            {"uid": user.id, "exp": datetime.utcnow() + timedelta(hours=1)},
            module.SECRET_KEY, algorithm="HS256",
        )

    assert signed_in_as(bearer(module, old_style))["username"] == "legacy"


def test_the_obvious_passwords_are_refused(tmp_path):
    """Eight characters was the only rule, so "password" passed it."""
    module = load(tmp_path)
    client = module.app.test_client()
    for index, bad in enumerate(("password", "12345678", "aaaaaaaa")):
        response = client.post(
            "/api/auth/register", json={"username": f"weakone{index}", "password": bad}
        )
        assert response.status_code == 400, f"{bad!r} was accepted"


def test_a_password_cannot_be_the_username(tmp_path):
    module = load(tmp_path)
    response = module.app.test_client().post(
        "/api/auth/register", json={"username": "samesame", "password": "samesame"}
    )
    assert response.status_code == 400


def test_the_same_rules_apply_when_changing_it(tmp_path):
    """Two places to set a password is two places the rules can drift."""
    module = load(tmp_path)
    client, _ = register(module, "drifter")

    response = client.post("/api/auth/password", json={
        "current_password": "Str0ng-Pass!1", "new_password": "password",
    })
    assert response.status_code == 400, response.get_data(as_text=True)


def test_an_account_can_be_deleted(tmp_path):
    """Apple requires this of any app that lets you make an account."""
    module = load(tmp_path)
    client, token = register(module, "goneaway")

    assert client.delete(
        "/api/auth/account", json={"password": "Str0ng-Pass!1"}
    ).status_code == 200

    with module.app.app_context():
        assert module.User.query.filter_by(username="goneaway").first() is None
    assert signed_in_as(bearer(module, token)) is None


def test_deleting_needs_the_password(tmp_path):
    """It cannot be undone, so a token alone is too weak a claim."""
    module = load(tmp_path)
    client, _ = register(module, "stayput")

    assert client.delete(
        "/api/auth/account", json={"password": "wrong"}
    ).status_code == 403
    with module.app.app_context():
        assert module.User.query.filter_by(username="stayput").first() is not None


def test_deleting_leaves_the_opponent_record_alone(tmp_path):
    """Their opponent's rating was built on those matches."""
    module = load(tmp_path)
    leaver, _ = register(module, "leaver")
    stayer, _ = register(module, "stayer2")

    match_id = leaver.post(
        "/api/matches/quick", json={"game_slug": "pushups"}
    ).get_json()["match_id"]
    stayer.post("/api/matches/quick", json={"game_slug": "pushups"})
    leaver.post(f"/api/matches/{match_id}/submit", json={"score": 5})
    stayer.post(f"/api/matches/{match_id}/submit", json={"score": 30})

    with module.app.app_context():
        won_at = module.User.query.filter_by(username="stayer2").first().rating

    leaver.delete("/api/auth/account", json={"password": "Str0ng-Pass!1"})

    with module.app.app_context():
        assert module.User.query.filter_by(username="stayer2").first().rating == won_at
        match = module.db.session.get(module.Match, match_id)
        names = {p.display_name for p in match.players}
        assert "Deleted player" in names, names
        assert "leaver" not in names, "the deleted account is still named on the match"


def test_a_guest_has_no_password_to_change(tmp_path):
    module = load(tmp_path)
    client = module.app.test_client()
    client.post("/api/auth/guest")
    assert client.post("/api/auth/password", json={
        "current_password": "x", "new_password": "An0ther-Pass!2",
    }).status_code in (401, 403)
