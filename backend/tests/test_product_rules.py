"""Rules that define the product shape: social versus competitive, unique
guest identities, and rooms that clean themselves up."""

import importlib
import os
import re
from datetime import datetime, timedelta


def load(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    return importlib.import_module("app")


def guest_client(module):
    client = module.app.test_client()
    created = client.post("/api/auth/guest")
    assert created.status_code == 200
    return client, created.get_json()


def user_client(module, username):
    client = module.app.test_client()
    response = client.post(
        "/api/auth/register", json={"username": username, "password": "Str0ng-Pass!1"}
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    return client


def test_guest_names_carry_a_hex_discriminator(tmp_path):
    """Two guests must be tellable apart on screen, so names look like
    Guest#a3f2c1 rather than a bare, collidable label."""
    module = load(tmp_path)
    _, first = guest_client(module)
    _, second = guest_client(module)

    for session in (first, second):
        assert re.fullmatch(r".+#[0-9a-f]{6}", session["display_name"]), session["display_name"]
    assert first["display_name"] != second["display_name"]


def test_games_are_split_into_social_and_competitive(tmp_path):
    module = load(tmp_path)
    games = module.app.test_client().get("/api/games").get_json()
    by_slug = {g["slug"]: g for g in games}

    assert by_slug["groupchat"]["category"] == "social", "text chat is a social channel, not a contest"
    assert by_slug["groupchat"]["category"] == "social"
    assert by_slug["pushups"]["category"] == "competitive"
    assert by_slug["rapbattle"]["category"] == "competitive"
    # Facial Symmetry and Mog were the same idea; they are one game now.
    assert "symmetry" not in by_slug
    assert by_slug["looks"]["category"] == "competitive"


def test_competitive_games_cannot_be_entered_by_room_code(tmp_path):
    """Competitive is matchmaking only, so ranked play cannot be arranged
    privately between friends."""
    module = load(tmp_path)
    host = user_client(module, "code_host")

    response = host.post("/api/rooms", json={"game_slug": "pushups"})

    assert response.status_code == 400, response.get_data(as_text=True)
    assert "competitive" in response.get_json()["error"].lower()


def test_social_games_can_still_use_rooms(tmp_path):
    module = load(tmp_path)
    host = user_client(module, "social_host")
    response = host.post("/api/rooms", json={"game_slug": "groupchat"})
    assert response.status_code == 200, response.get_data(as_text=True)


def test_matchmaking_prefers_a_similar_rating(tmp_path):
    """Competitive pairing feeds the ladder, so a 1000 should be handed the
    waiting 1010 rather than the 2400 that queued first."""
    module = load(tmp_path)
    user_client(module, "far_rating")
    user_client(module, "near_rating")
    seeker = user_client(module, "seeker")

    # Two independent queued matches. Going through the endpoint twice would
    # simply pair those two with each other, leaving nothing to choose between.
    with module.app.app_context():
        game = module.Game.query.filter_by(slug="rapbattle").first()
        # Other tests share this database, so clear any queue they left.
        for leftover in module.Match.query.filter_by(game_id=game.id, status="waiting").all():
            module.MatchPlayer.query.filter_by(match_id=leftover.id).delete()
            module.db.session.delete(leftover)
        module.db.session.flush()
        near_match_id = None
        for username, rating in (("far_rating", 2400), ("near_rating", 1010)):
            waiter = module.User.query.filter_by(username=username).first()
            waiter.rating = rating
            match = module.Match(
                game_id=game.id,
                room_code=module.gen_room_code(),
                host_user_id=waiter.id,
                status="waiting",
            )
            module.db.session.add(match)
            module.db.session.flush()
            module.db.session.add(module.MatchPlayer(
                match_id=match.id, user_id=waiter.id, display_name=username
            ))
            if username == "near_rating":
                near_match_id = match.id
        module.User.query.filter_by(username="seeker").first().rating = 1000
        module.db.session.commit()

    got = seeker.post("/api/matches/quick", json={"game_slug": "rapbattle"}).get_json()

    assert got["match_id"] == near_match_id, "paired with the far-off rating instead of the close one"


def test_an_empty_room_is_cleaned_up_after_a_minute(tmp_path):
    """Nobody should browse into a room that everyone abandoned."""
    module = load(tmp_path)
    host = user_client(module, "cleanup_host")
    code = host.post("/api/rooms", json={"game_slug": "groupchat"}).get_json()["code"]
    host.post(f"/api/rooms/{code}/join")

    with module.app.app_context():
        match = module.Match.query.filter_by(room_code=code).first()
        for player in match.players:
            player.left_at = datetime.utcnow() - timedelta(seconds=90)
        module.db.session.commit()

    listed = module.app.test_client().get("/api/rooms").get_json()

    assert code not in [room["code"] for room in listed], "abandoned room still advertised"
    with module.app.app_context():
        assert module.Room.query.filter_by(code=code).first() is None, "abandoned room not deleted"


def test_guests_can_open_a_social_channel(tmp_path):
    """Social is the front door and guests are most of it, so creating a
    channel must not demand an account."""
    module = load(tmp_path)
    client, _ = guest_client(module)

    response = client.post("/api/rooms", json={"game_slug": "groupchat"})

    assert response.status_code == 200, response.get_data(as_text=True)
    assert response.get_json()["code"]
