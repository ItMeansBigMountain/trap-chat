"""An empty app and a broken app look identical, and that is the difference
between somebody coming back tomorrow and not. This is the number that tells
them apart."""

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


def test_nobody_online_is_reported_as_nobody(tmp_path):
    module = load(tmp_path)

    presence = module.app.test_client().get("/api/presence").get_json()

    assert presence["online"] == 0
    assert presence["open_rooms"] == 0


def test_a_connected_socket_counts_as_somebody(tmp_path):
    module = load(tmp_path)
    client = guest(module)
    socket = module.socketio.test_client(module.app, flask_test_client=client)

    presence = client.get("/api/presence").get_json()

    assert presence["online"] == 1, presence
    socket.disconnect()


def test_one_person_on_two_tabs_is_one_person(tmp_path):
    """Two tabs of one browser share a login. Counting them twice would
    inflate the only number a visitor uses to decide whether to stay."""
    module = load(tmp_path)
    client = guest(module)
    first = module.socketio.test_client(module.app, flask_test_client=client)
    second = module.socketio.test_client(module.app, flask_test_client=client)

    presence = client.get("/api/presence").get_json()

    assert presence["online"] == 1, presence
    first.disconnect()
    second.disconnect()


def test_leaving_takes_you_out_of_the_count(tmp_path):
    module = load(tmp_path)
    client = guest(module)
    socket = module.socketio.test_client(module.app, flask_test_client=client)
    assert client.get("/api/presence").get_json()["online"] == 1

    socket.disconnect()

    assert client.get("/api/presence").get_json()["online"] == 0


def test_queued_players_are_reported_per_game(tmp_path):
    """"Nobody is waiting for push-ups" and "nobody is here at all" are
    different things to tell somebody."""
    module = load(tmp_path)
    guest(module).post("/api/matches/quick", json={"game_slug": "pushups"})

    waiting = module.app.test_client().get("/api/presence").get_json()["waiting"]

    assert waiting["pushups"] == 1, waiting
    assert waiting["squats"] == 0


def test_a_held_back_game_is_not_reported(tmp_path):
    module = load(tmp_path)

    waiting = module.app.test_client().get("/api/presence").get_json()["waiting"]

    assert "rapbattle" not in waiting, waiting


def test_open_rooms_are_counted(tmp_path):
    module = load(tmp_path)
    host = guest(module)
    room = host.post("/api/rooms", json={"game_slug": "groupchat", "name": "somewhere"}).get_json()
    host.post(f"/api/rooms/{room['code']}/join")

    assert module.app.test_client().get("/api/presence").get_json()["open_rooms"] == 1
