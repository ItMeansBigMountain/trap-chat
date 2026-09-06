"""Social has two shapes, 1:1 and group, and its rooms are browsable, named
and joinable by code. Guests are first-class there, so they get to pick a name.
"""

import importlib
import os


def load(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    return importlib.import_module("app")


def guest(module, display_name=None):
    client = module.app.test_client()
    payload = {"display_name": display_name} if display_name else {}
    created = client.post("/api/auth/guest", json=payload)
    assert created.status_code == 200, created.get_data(as_text=True)
    return client, created.get_json()


def test_guest_can_choose_a_username(tmp_path):
    """A guest is still a person, so they get a name they picked, with the hex
    kept on the end to keep it unique."""
    module = load(tmp_path)
    _, session = guest(module, display_name="Affan")

    assert session["display_name"].startswith("Affan#"), session["display_name"]


def test_a_blank_guest_name_still_gets_a_default(tmp_path):
    module = load(tmp_path)
    _, session = guest(module)
    assert session["display_name"].startswith("Guest#"), session["display_name"]


def test_the_chosen_guest_name_is_used_in_a_room(tmp_path):
    module = load(tmp_path)
    client, _ = guest(module, display_name="Affan")
    code = client.post("/api/rooms", json={"game_slug": "groupchat"}).get_json()["code"]
    client.post(f"/api/rooms/{code}/join")

    listed = client.get("/api/rooms").get_json()
    room = next(r for r in listed if r["code"] == code)

    assert room["players"][0]["display_name"].startswith("Affan#"), room["players"]


def test_social_offers_both_one_to_one_and_group(tmp_path):
    module = load(tmp_path)
    games = module.app.test_client().get("/api/games").get_json()
    social = {g["slug"]: g for g in games if g["category"] == "social"}

    assert social["chat1v1"]["max_players"] == 2, "1:1 must hold exactly two people"
    assert social["groupchat"]["max_players"] > 2, "group chat must hold a crowd"


def test_a_room_can_be_named(tmp_path):
    """People should be able to call a room whatever they want, so it is
    findable when browsing."""
    module = load(tmp_path)
    client, _ = guest(module)

    created = client.post("/api/rooms", json={"game_slug": "groupchat", "name": "late night trap"})

    assert created.status_code == 200, created.get_data(as_text=True)
    code = created.get_json()["code"]
    listed = client.get("/api/rooms").get_json()
    room = next(r for r in listed if r["code"] == code)
    assert room["name"] == "late night trap"


def test_an_unnamed_room_still_lists_with_something_readable(tmp_path):
    module = load(tmp_path)
    client, _ = guest(module)
    code = client.post("/api/rooms", json={"game_slug": "groupchat"}).get_json()["code"]
    room = next(r for r in client.get("/api/rooms").get_json() if r["code"] == code)
    assert room["name"], "a nameless room needs a fallback label"


def test_a_full_one_to_one_room_refuses_a_third_person(tmp_path):
    """Random 1:1 only works if a pair is actually a pair."""
    module = load(tmp_path)
    first, _ = guest(module)
    second, _ = guest(module)
    third, _ = guest(module)

    code = first.post("/api/rooms", json={"game_slug": "chat1v1"}).get_json()["code"]
    assert first.post(f"/api/rooms/{code}/join").status_code == 200
    assert second.post(f"/api/rooms/{code}/join").status_code == 200

    response = third.post(f"/api/rooms/{code}/join")

    assert response.status_code == 400, response.get_data(as_text=True)
    assert "full" in response.get_json()["error"].lower()


def test_browsing_shows_occupancy_so_you_can_pick(tmp_path):
    module = load(tmp_path)
    client, _ = guest(module)
    code = client.post("/api/rooms", json={"game_slug": "groupchat"}).get_json()["code"]
    client.post(f"/api/rooms/{code}/join")

    room = next(r for r in client.get("/api/rooms").get_json() if r["code"] == code)

    assert room["player_count"] == 1
    assert room["max_players"] > 2
