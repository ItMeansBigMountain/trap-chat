"""A room's name is what people pick it out by in Browse, so who is allowed to
change it matters."""

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


def a_room(module, client, name="first name"):
    room = client.post(
        "/api/rooms", json={"game_slug": "groupchat", "name": name}
    ).get_json()
    client.post(f"/api/rooms/{room['code']}/join")
    return room["code"]


def test_someone_in_the_room_can_rename_it(tmp_path):
    module = load(tmp_path)
    host = guest(module)
    code = a_room(module, host)

    response = host.put(f"/api/rooms/{code}/name", json={"name": "the trap house"})

    assert response.status_code == 200, response.get_data(as_text=True)
    assert response.get_json()["name"] == "the trap house"
    listed = {r["code"]: r["name"] for r in host.get("/api/rooms").get_json()}
    assert listed[code] == "the trap house"


def test_a_passer_by_cannot_rename_your_room(tmp_path):
    """Otherwise anybody could rename a room to impersonate one somebody else
    built, which is the whole reason Browse is browsable."""
    module = load(tmp_path)
    host = guest(module)
    code = a_room(module, host)

    response = guest(module).put(f"/api/rooms/{code}/name", json={"name": "mine now"})

    assert response.status_code == 403, response.get_data(as_text=True)


def test_a_room_cannot_be_renamed_to_nothing(tmp_path):
    module = load(tmp_path)
    host = guest(module)
    code = a_room(module, host)

    assert host.put(f"/api/rooms/{code}/name", json={"name": "   "}).status_code == 400


def test_renaming_an_unknown_room_is_a_404(tmp_path):
    module = load(tmp_path)
    assert guest(module).put("/api/rooms/NOPE1234/name", json={"name": "x"}).status_code == 404


def test_everyone_in_the_room_is_told(tmp_path):
    """The other people in the room see the name they are sitting in change."""
    module = load(tmp_path)
    host = guest(module)
    code = a_room(module, host)
    joined = guest(module)
    match_id = joined.post(f"/api/rooms/{code}/join").get_json()["match_id"]

    listener = module.socketio.test_client(module.app, flask_test_client=joined)
    listener.emit("join_match", {"match_id": match_id})
    listener.get_received()

    host.put(f"/api/rooms/{code}/name", json={"name": "renamed live"})

    events = [m for m in listener.get_received() if m["name"] == "room_renamed"]
    assert events, "nobody was told the room was renamed"
    assert events[-1]["args"][0]["name"] == "renamed live"
