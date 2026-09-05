"""Rooms are how two people deliberately meet, so joining one has to put both
of them in the same match."""

import importlib
import os


def load_app(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    module = importlib.import_module("app")
    return module.app


def client_for(app, username):
    client = app.test_client()
    response = client.post(
        "/api/auth/register",
        json={"username": username, "password": "Str0ng-Pass!1"},
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    return client


def test_two_players_joining_one_room_land_in_the_same_match(tmp_path):
    """Match.room_code is unique, so creating a fresh Match per join makes the
    second joiner fail outright and leaves the first one alone in a room."""
    app = load_app(tmp_path)
    host = client_for(app, "room_host")
    guest = client_for(app, "room_guest")

    created = host.post("/api/rooms", json={"game_slug": "rapbattle"})
    assert created.status_code == 200, created.get_data(as_text=True)
    code = created.get_json()["code"]

    host_join = host.post(f"/api/rooms/{code}/join")
    assert host_join.status_code == 200, host_join.get_data(as_text=True)

    guest_join = guest.post(f"/api/rooms/{code}/join")
    assert guest_join.status_code == 200, guest_join.get_data(as_text=True)

    assert host_join.get_json()["match_id"] == guest_join.get_json()["match_id"], (
        "both players must share one match, otherwise they cannot see each other"
    )


def test_rejoining_a_room_does_not_duplicate_the_player(tmp_path):
    """A reconnect or a double tap must not add the same person twice."""
    app = load_app(tmp_path)
    host = client_for(app, "rejoin_host")

    code = host.post("/api/rooms", json={"game_slug": "rapbattle"}).get_json()["code"]
    first = host.post(f"/api/rooms/{code}/join")
    second = host.post(f"/api/rooms/{code}/join")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.get_json()["match_id"] == second.get_json()["match_id"]

    match_id = first.get_json()["match_id"]
    with app.app_context():
        from app import MatchPlayer

        players = MatchPlayer.query.filter_by(match_id=match_id).all()
        assert len(players) == 1, f"expected one player row, got {len(players)}"
