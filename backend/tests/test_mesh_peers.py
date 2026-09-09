"""A room bigger than two needs peers you can address.

Video used to be one connection, so a group room showed you whoever offered
last and no sign that anybody else existed. A mesh needs two things the old
signalling could not give it: a roster in terms of something that can be
routed to, and delivery to one peer rather than the whole room.

The socket id is that something. A player row id cannot be delivered to.
"""

import importlib
import os


def load(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    return importlib.import_module("app")


def guest(module):
    client = module.app.test_client()
    client.post("/api/auth/guest")
    return client


def joined(module, client, match_id):
    socket = module.socketio.test_client(module.app, flask_test_client=client)
    socket.emit("join_match", {"match_id": match_id})
    return socket


def paired(module, one, two, slug="chat1v1"):
    first = one.post("/api/matches/quick", json={"game_slug": slug}).get_json()
    second = two.post("/api/matches/quick", json={"game_slug": slug}).get_json()
    assert first["match_id"] == second["match_id"], (first, second)
    return first["match_id"]


def events(socket, name):
    return [m for m in socket.get_received() if m["name"] == name]


def test_joining_tells_you_who_is_already_here(tmp_path):
    module = load(tmp_path)
    one, two = guest(module), guest(module)
    match_id = paired(module, one, two)

    first = joined(module, one, match_id)
    first.get_received()
    second = joined(module, two, match_id)

    peers = events(second, "peers")
    assert peers, "the joiner was told nothing about the room"
    payload = peers[-1]["args"][0]
    assert payload["you"], "a peer that does not know its own id cannot decide who offers"
    assert len(payload["peers"]) == 1, payload
    assert payload["peers"][0]["peer_id"] != payload["you"]


def test_the_first_person_in_is_told_the_room_is_empty(tmp_path):
    """Not an error, and not silence: an empty list is the answer."""
    module = load(tmp_path)
    one, two = guest(module), guest(module)
    match_id = paired(module, one, two)

    first = joined(module, one, match_id)
    payload = events(first, "peers")[-1]["args"][0]
    assert payload["peers"] == []


def test_everyone_already_here_hears_about_an_arrival(tmp_path):
    module = load(tmp_path)
    one, two = guest(module), guest(module)
    match_id = paired(module, one, two)

    first = joined(module, one, match_id)
    first.get_received()
    joined(module, two, match_id)

    arrivals = events(first, "peer_joined")
    assert arrivals, "nobody was told a peer arrived"
    assert arrivals[-1]["args"][0]["peer_id"], arrivals


def test_a_signal_reaches_only_the_peer_it_names(tmp_path):
    """The rule the mesh depends on. Broadcasting an offer into a room of
    three means two people answer it, and each of those answers lands on a
    connection that was never offered to them."""
    module = load(tmp_path)
    one, two, three = guest(module), guest(module), guest(module)
    # Group rooms are made and joined by code, not quick-matched: quick match
    # is 1v1 only, and a mesh only matters once a room holds three.
    code = one.post(
        "/api/rooms", json={"game_slug": "groupchat", "name": "mesh"}
    ).get_json()["code"]
    # The match is minted by the first join, not by making the room.
    match_id = one.post(f"/api/rooms/{code}/join").get_json()["match_id"]
    for client in (two, three):
        client.post(f"/api/rooms/{code}/join")

    a = joined(module, one, match_id)
    b = joined(module, two, match_id)
    c = joined(module, three, match_id)
    b_id = events(b, "peers")[-1]["args"][0]["you"]
    a.get_received(), b.get_received(), c.get_received()

    a.emit("signal", {"match_id": match_id, "type": "offer", "offer": {}, "to": b_id})

    assert events(b, "signal"), "the addressed peer got nothing"
    assert not events(c, "signal"), "a third party received an offer meant for someone else"


def test_a_signal_to_nobody_in_the_room_goes_nowhere(tmp_path):
    module = load(tmp_path)
    one, two = guest(module), guest(module)
    match_id = paired(module, one, two)

    a = joined(module, one, match_id)
    b = joined(module, two, match_id)
    a.get_received(), b.get_received()

    a.emit("signal", {"match_id": match_id, "type": "offer", "offer": {}, "to": "not-a-socket"})

    assert not events(b, "signal"), "a misaddressed signal was broadcast to the room"


def test_an_unaddressed_signal_still_reaches_the_room(tmp_path):
    """A client from before the mesh has no peer ids to address. It is a room
    of two, where the room is the peer, so the broadcast is still correct."""
    module = load(tmp_path)
    one, two = guest(module), guest(module)
    match_id = paired(module, one, two)

    a = joined(module, one, match_id)
    b = joined(module, two, match_id)
    a.get_received(), b.get_received()

    a.emit("signal", {"match_id": match_id, "type": "offer", "offer": {}})

    assert events(b, "signal"), "an old client can no longer connect"


def test_leaving_takes_your_tile_with_you(tmp_path):
    module = load(tmp_path)
    one, two = guest(module), guest(module)
    match_id = paired(module, one, two)

    a = joined(module, one, match_id)
    b = joined(module, two, match_id)
    a.get_received()

    b.emit("leave_match", {"match_id": match_id})

    gone = events(a, "peer_left")
    assert gone, "the room was never told the peer left"
    assert gone[-1]["args"][0]["peer_id"], gone


def test_a_dropped_socket_takes_its_tile_too(tmp_path):
    """Otherwise the tile sits there showing a frozen frame forever."""
    module = load(tmp_path)
    one, two = guest(module), guest(module)
    match_id = paired(module, one, two)

    a = joined(module, one, match_id)
    b = joined(module, two, match_id)
    a.get_received()

    b.disconnect()

    assert events(a, "peer_left"), "a dropped peer kept its tile"
