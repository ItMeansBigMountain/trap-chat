import importlib
import sys

import pytest


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'trapchat.db'}")
    monkeypatch.setenv("SECRET_KEY", "test-secret")
    sys.modules.pop("app", None)
    module = importlib.import_module("app")
    module.app.config.update(TESTING=True)
    return module.app.test_client()


def create_guest(client):
    response = client.post("/api/auth/guest")
    assert response.status_code == 200
    return response


def test_quick_match_requires_an_identifiable_guest_or_authenticated_user(client):
    response = client.post("/api/matches/quick", json={"game_slug": "pushups"})

    assert response.status_code == 401
    assert response.get_json() == {"error": "guest session required"}


def test_quick_match_does_not_add_the_same_guest_twice(client):
    create_guest(client)

    first = client.post("/api/matches/quick", json={"game_slug": "pushups"})
    second = client.post("/api/matches/quick", json={"game_slug": "pushups"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.get_json()["match_id"] == first.get_json()["match_id"]
    assert second.get_json()["status"] == "waiting"
    assert len(second.get_json()["players"]) == 1


def test_two_distinct_guests_activate_a_quick_match(client):
    create_guest(client)
    first = client.post("/api/matches/quick", json={"game_slug": "pushups"})

    opponent = client.application.test_client()
    create_guest(opponent)
    second = opponent.post("/api/matches/quick", json={"game_slug": "pushups"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.get_json()["match_id"] == first.get_json()["match_id"]
    assert second.get_json()["status"] == "active"
    assert len(second.get_json()["players"]) == 2


def test_quick_match_ignores_a_stale_waiting_match(tmp_path):
    """A waiting match whose player closed their tab hours ago must not be
    handed to the next person: they would sit in a room with a ghost."""
    import importlib
    import os
    from datetime import datetime, timedelta

    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    module = importlib.import_module("app")
    app = module.app

    abandoner = app.test_client()
    abandoner.post("/api/auth/register", json={"username": "ghost_player", "password": "Str0ng-Pass!1"})
    first = abandoner.post("/api/matches/quick", json={"game_slug": "rapbattle"})
    assert first.status_code == 200
    stale_match_id = first.get_json()["match_id"]

    # Age that queued match well past any sensible window.
    with app.app_context():
        stale = module.db.session.get(module.Match, stale_match_id)
        stale.created_at = datetime.utcnow() - timedelta(hours=3)
        module.db.session.commit()

    newcomer = app.test_client()
    newcomer.post("/api/auth/register", json={"username": "fresh_player", "password": "Str0ng-Pass!1"})
    second = newcomer.post("/api/matches/quick", json={"game_slug": "rapbattle"})

    assert second.status_code == 200, second.get_data(as_text=True)
    body = second.get_json()
    assert body["match_id"] != stale_match_id, "joined an abandoned queue instead of starting a fresh one"
    assert body["status"] == "waiting"
