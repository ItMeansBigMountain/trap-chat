"""Forfeiting should not throw you out of the room.

It used to be the same event as leaving, and leave_match calls leave_room()
before the match settles -- so the person who conceded was already out of the
room when the result was broadcast. They never saw it. They were dropped back
to the lobby with no idea what had happened, while the player who beat them
got a whole screen about it.

Conceding and leaving are two decisions now. This pins both halves: the
forfeit is still scored as a loss, and the person who took it still hears how
it ended.
"""

import importlib
import os


def load(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    return importlib.import_module("app")


def account(module, username):
    client = module.app.test_client()
    response = client.post(
        "/api/auth/register", json={"username": username, "password": "Str0ng-Pass!1"}
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    return client


def matched(module, one, two, slug="pushups"):
    first = one.post("/api/matches/quick", json={"game_slug": slug}).get_json()
    second = two.post("/api/matches/quick", json={"game_slug": slug}).get_json()
    assert first["match_id"] == second["match_id"], (first, second)
    return first["match_id"]


def rating_of(module, username):
    with module.app.app_context():
        return module.User.query.filter_by(username=username).first().rating


def finished_events(socket):
    return [m for m in socket.get_received() if m["name"] == "match_finished"]


def test_the_player_who_forfeits_is_told_how_it_ended(tmp_path):
    """The whole point. Before this the event went to a room they had left."""
    module = load(tmp_path)
    stayer, quitter = account(module, "told_stay"), account(module, "told_quit")
    match_id = matched(module, stayer, quitter)

    socket = module.socketio.test_client(module.app, flask_test_client=quitter)
    socket.emit("join_match", {"match_id": match_id})
    socket.get_received()

    socket.emit("forfeit_match", {"match_id": match_id})

    events = finished_events(socket)
    assert events, "the player who forfeited was told nothing"
    payload = events[-1]["args"][0]
    assert payload["outcome"] == "forfeit", payload
    assert payload["winner"] == "told_stay", payload


def test_the_other_player_is_told_too(tmp_path):
    module = load(tmp_path)
    stayer, quitter = account(module, "other_stay"), account(module, "other_quit")
    match_id = matched(module, stayer, quitter)

    watcher = module.socketio.test_client(module.app, flask_test_client=stayer)
    watcher.emit("join_match", {"match_id": match_id})
    watcher.get_received()

    loser = module.socketio.test_client(module.app, flask_test_client=quitter)
    loser.emit("join_match", {"match_id": match_id})
    loser.emit("forfeit_match", {"match_id": match_id})

    events = finished_events(watcher)
    assert events, "the winner was not told"
    assert events[-1]["args"][0]["winner"] == "other_stay"


def test_forfeiting_is_still_a_loss(tmp_path):
    """Staying to read the result must not make it cost less."""
    module = load(tmp_path)
    stayer, quitter = account(module, "cost_stay"), account(module, "cost_quit")
    match_id = matched(module, stayer, quitter)

    socket = module.socketio.test_client(module.app, flask_test_client=quitter)
    socket.emit("join_match", {"match_id": match_id})
    socket.emit("forfeit_match", {"match_id": match_id})

    assert rating_of(module, "cost_quit") < 1000, "forfeiting cost nothing"
    assert rating_of(module, "cost_stay") > 1000, "the player who stayed gained nothing"


def test_the_seat_is_not_released_until_they_leave(tmp_path):
    """They are still in the room, watching. That is what keeps the result on
    their screen instead of dropping them to the lobby."""
    module = load(tmp_path)
    stayer, quitter = account(module, "seat_stay"), account(module, "seat_quit")
    match_id = matched(module, stayer, quitter)

    socket = module.socketio.test_client(module.app, flask_test_client=quitter)
    socket.emit("join_match", {"match_id": match_id})
    socket.emit("forfeit_match", {"match_id": match_id})

    with module.app.app_context():
        match = module.db.session.get(module.Match, match_id)
        assert match.status == "finished"
        left = [p for p in match.players if p.left_at is not None]
        assert left == [], "the forfeiting player was removed from the room"


def test_forfeiting_twice_does_not_move_rating_twice(tmp_path):
    """The button is on screen until they leave, so it can be pressed again."""
    module = load(tmp_path)
    stayer, quitter = account(module, "twice_stay"), account(module, "twice_quit")
    match_id = matched(module, stayer, quitter)

    socket = module.socketio.test_client(module.app, flask_test_client=quitter)
    socket.emit("join_match", {"match_id": match_id})
    socket.emit("forfeit_match", {"match_id": match_id})
    once = rating_of(module, "twice_quit")
    socket.emit("forfeit_match", {"match_id": match_id})

    assert rating_of(module, "twice_quit") == once, "settled twice"


def test_leaving_after_forfeiting_still_works(tmp_path):
    """Conceding is the first decision; leaving is the second."""
    module = load(tmp_path)
    stayer, quitter = account(module, "after_stay"), account(module, "after_quit")
    match_id = matched(module, stayer, quitter)

    socket = module.socketio.test_client(module.app, flask_test_client=quitter)
    socket.emit("join_match", {"match_id": match_id})
    socket.emit("forfeit_match", {"match_id": match_id})
    socket.emit("leave_match", {"match_id": match_id})

    with module.app.app_context():
        match = module.db.session.get(module.Match, match_id)
        gone = [p for p in match.players if p.left_at is not None]
        assert len(gone) == 1, "leaving after forfeiting did not release the seat"


def test_leaving_without_forfeiting_is_still_a_forfeit(tmp_path):
    """Walking out mid-match is the same decision, and must still be scored.
    Splitting the two events must not open a way to leave for free."""
    module = load(tmp_path)
    stayer, quitter = account(module, "walk_stay"), account(module, "walk_quit")
    match_id = matched(module, stayer, quitter)

    socket = module.socketio.test_client(module.app, flask_test_client=quitter)
    socket.emit("join_match", {"match_id": match_id})
    socket.emit("leave_match", {"match_id": match_id})

    assert rating_of(module, "walk_quit") < 1000, "walking out became free"
