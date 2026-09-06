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

    created = host.post("/api/rooms", json={"game_slug": "groupchat"})
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

    code = host.post("/api/rooms", json={"game_slug": "groupchat"}).get_json()["code"]
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


def abandoned_room(module):
    """A room two people joined over HTTP and nobody held a socket in, which
    is exactly how the smoke tests left eleven of them in production."""
    host = module.app.test_client()
    host.post("/api/auth/guest")
    room = host.post(
        "/api/rooms", json={"game_slug": "groupchat", "name": "smoke room"}
    ).get_json()
    host.post(f"/api/rooms/{room['code']}/join")
    other = module.app.test_client()
    other.post("/api/auth/guest")
    joined = other.post(f"/api/rooms/{room['code']}/join").get_json()
    return host, room["code"], joined["match_id"]


def browsable(client):
    return [room["code"] for room in client.get("/api/rooms").get_json()]


def test_a_room_nobody_is_connected_to_is_reaped(tmp_path):
    """left_at is only ever written by a socket event, so a player who never
    opened one held their seat forever and the room stayed in Browse for good.
    Presence has to be observed, not inferred from a column nobody set."""
    import importlib, os
    from datetime import datetime, timedelta

    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    module = importlib.import_module("app")
    host, code, match_id = abandoned_room(module)

    assert code in browsable(host), "the room was never browsable to begin with"

    # No socket has been in it for well past the timeout.
    module.MATCH_LAST_SEEN[match_id] = datetime.utcnow() - timedelta(
        seconds=module.EMPTY_ROOM_TIMEOUT_SECONDS + 30
    )

    assert code not in browsable(host), "an abandoned room is still in Browse"


def test_a_room_someone_is_still_connected_to_survives(tmp_path):
    """The other half of the rule. Someone sitting quietly in a group chat
    sends no events for minutes, and must not have the room deleted round them."""
    import importlib, os
    from datetime import datetime, timedelta

    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    module = importlib.import_module("app")
    host, code, match_id = abandoned_room(module)

    module.MATCH_LAST_SEEN[match_id] = datetime.utcnow() - timedelta(
        seconds=module.EMPTY_ROOM_TIMEOUT_SECONDS + 30
    )
    # ...but a socket is still holding it open, saying nothing.
    module.SOCKET_IDENTITIES["a-silent-socket"] = {"matches": {match_id}}
    try:
        assert code in browsable(host), "a room with someone still in it was deleted"
    finally:
        module.SOCKET_IDENTITIES.pop("a-silent-socket", None)
