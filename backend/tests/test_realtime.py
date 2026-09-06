import importlib
import sys

import pytest


@pytest.fixture
def backend(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'trapchat.db'}")
    monkeypatch.setenv("SECRET_KEY", "test-secret")
    sys.modules.pop("app", None)
    return importlib.import_module("app")


def guest_with_match(backend):
    http = backend.app.test_client()
    http.post("/api/auth/guest")
    match = http.post("/api/matches/quick", json={"game_slug": "pushups"}).get_json()
    socket = backend.socketio.test_client(backend.app, flask_test_client=http)
    return http, socket, match


def event_payload(client, name):
    return [item["args"][0] for item in client.get_received() if item["name"] == name]


def test_match_member_can_join_and_relay_chat_and_signals(backend):
    _, first, match = guest_with_match(backend)
    _, second, opponent_match = guest_with_match(backend)
    assert opponent_match["match_id"] == match["match_id"]

    first.emit("join_match", {"match_id": match["match_id"]})
    second.emit("join_match", {"match_id": match["match_id"]})
    first.get_received()
    second.get_received()

    first.emit("chat_message", {"match_id": match["match_id"], "text": "hello"})
    chats = event_payload(second, "chat_message")
    assert chats[0]["match_id"] == match["match_id"]
    assert chats[0]["text"] == "hello"
    assert chats[0]["from"].startswith("Guest#")

    first.emit("signal", {"match_id": match["match_id"], "type": "offer", "offer": {"sdp": "test"}})
    signals = event_payload(second, "signal")
    assert signals[0]["type"] == "offer"
    assert signals[0]["offer"] == {"sdp": "test"}


def test_non_member_cannot_join_or_send_to_match(backend):
    _, member, match = guest_with_match(backend)
    outsider_http = backend.app.test_client()
    outsider_http.post("/api/auth/guest")
    outsider = backend.socketio.test_client(backend.app, flask_test_client=outsider_http)

    member.emit("join_match", {"match_id": match["match_id"]})
    member.get_received()
    outsider.emit("join_match", {"match_id": match["match_id"]})
    errors = event_payload(outsider, "error")
    assert errors == [{"message": "not a player in this match", "code": "forbidden"}]

    outsider.emit("chat_message", {"match_id": match["match_id"], "text": "intrusion"})
    assert event_payload(member, "chat_message") == []


def test_a_dropped_socket_does_not_pull_you_out_of_the_queue(backend):
    """Socket.IO reconnects on any blip, and a tab in the background drops.
    Losing the socket while queued must not remove you from your own match,
    or the opponent who arrives next finds an empty room and both wait."""
    http, socket, match = guest_with_match(backend)
    match_id = match["match_id"]
    socket.emit("join_match", {"match_id": match_id})

    socket.disconnect()

    with backend.app.app_context():
        players = backend.MatchPlayer.query.filter_by(match_id=match_id).all()
        assert players, "the queued player disappeared entirely"
        assert all(p.left_at is None for p in players), (
            "a dropped socket marked the player as having left the queue"
        )


def test_an_opponent_still_starts_the_match_after_a_dropped_socket(backend):
    """The end result that matters: both players get into the match."""
    http_one, socket_one, first = guest_with_match(backend)
    socket_one.emit("join_match", {"match_id": first["match_id"]})
    socket_one.disconnect()

    http_two = backend.app.test_client()
    http_two.post("/api/auth/guest")
    second = http_two.post("/api/matches/quick", json={"game_slug": "pushups"}).get_json()

    assert second["match_id"] == first["match_id"], "queued into a separate match"
    assert second["status"] == "active", "the match never started"


def test_leaving_on_purpose_still_removes_you(backend):
    """Explicitly leaving is a decision, not a blip, so it must still count."""
    http, socket, match = guest_with_match(backend)
    match_id = match["match_id"]
    socket.emit("join_match", {"match_id": match_id})

    socket.emit("leave_match", {"match_id": match_id})

    with backend.app.app_context():
        players = backend.MatchPlayer.query.filter_by(match_id=match_id).all()
        assert all(p.left_at is not None for p in players), "leaving did not register"


def social_room(backend):
    """A social room with one occupant, entered the way the app enters one."""
    http = backend.app.test_client()
    http.post("/api/auth/guest")
    room = http.post(
        "/api/rooms", json={"game_slug": "groupchat", "name": "abandoned"}
    ).get_json()
    joined = http.post(f"/api/rooms/{room['code']}/join").get_json()
    socket = backend.socketio.test_client(backend.app, flask_test_client=http)
    socket.emit("join_match", {"match_id": joined["match_id"]})
    return http, socket, room["code"], joined["match_id"]


def test_closing_the_tab_frees_a_social_room(backend):
    """Browse filled up with rooms whose occupants had closed the tab. A
    social seat is not a queue slot, so dropping the socket releases it and
    the room becomes reapable."""
    _, socket, code, match_id = social_room(backend)

    socket.disconnect()

    with backend.app.app_context():
        players = backend.MatchPlayer.query.filter_by(match_id=match_id).all()
        assert players, "the occupant vanished instead of being marked gone"
        assert all(p.left_at is not None for p in players), (
            "the seat is still held, so the room can never be reaped"
        )


def test_an_abandoned_social_room_stops_being_browsable(backend):
    """The user-visible half: the room disappears from Browse once the
    timeout has passed."""
    from datetime import datetime, timedelta

    http, socket, code, match_id = social_room(backend)
    socket.disconnect()

    with backend.app.app_context():
        stale = datetime.utcnow() - timedelta(
            seconds=backend.EMPTY_ROOM_TIMEOUT_SECONDS + 30
        )
        for player in backend.MatchPlayer.query.filter_by(match_id=match_id).all():
            player.left_at = stale
        backend.db.session.commit()

    listed = [room["code"] for room in http.get("/api/rooms").get_json()]

    assert code not in listed, "an abandoned room is still offered in Browse"


def test_a_reconnecting_occupant_keeps_their_social_room(backend):
    """The seat is released, not destroyed. Coming back must reclaim it,
    otherwise a phone locking its screen loses the room."""
    http, socket, code, match_id = social_room(backend)
    socket.disconnect()

    again = backend.socketio.test_client(backend.app, flask_test_client=http)
    again.emit("join_match", {"match_id": match_id})

    with backend.app.app_context():
        players = backend.MatchPlayer.query.filter_by(match_id=match_id).all()
        assert any(p.left_at is None for p in players), "rejoining did not reclaim the seat"
    assert code in [room["code"] for room in http.get("/api/rooms").get_json()]
