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
