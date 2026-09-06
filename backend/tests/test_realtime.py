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
