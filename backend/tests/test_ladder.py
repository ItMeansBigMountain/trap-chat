"""A ranked match has to produce a winner and move both ratings, or "ranked"
is just a word. Before this, both results were broadcast side by side, nobody
was declared the winner, and User.rating was read for matchmaking but never
written, so everyone sat at 1000 forever."""

import importlib
import json
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


def guest(module):
    client = module.app.test_client()
    client.post("/api/auth/guest")
    return client


def matched(module, one, two, slug="pushups"):
    first = one.post("/api/matches/quick", json={"game_slug": slug}).get_json()
    second = two.post("/api/matches/quick", json={"game_slug": slug}).get_json()
    assert first["match_id"] == second["match_id"], (first, second)
    return first["match_id"]


def rating_of(module, username):
    with module.app.app_context():
        return module.User.query.filter_by(username=username).first().rating


def test_the_higher_score_wins_and_takes_rating(tmp_path):
    module = load(tmp_path)
    strong, weak = account(module, "strong"), account(module, "weak")
    match_id = matched(module, strong, weak)

    strong.post(f"/api/matches/{match_id}/submit", json={"score": 40})
    weak.post(f"/api/matches/{match_id}/submit", json={"score": 12})

    assert rating_of(module, "strong") > 1000, "the winner gained nothing"
    assert rating_of(module, "weak") < 1000, "the loser lost nothing"


def test_the_ladder_is_zero_sum(tmp_path):
    """Points come from the loser. Rating that appears from nowhere makes the
    board a measure of how much somebody played."""
    module = load(tmp_path)
    one, two = account(module, "zero_a"), account(module, "zero_b")
    match_id = matched(module, one, two)

    one.post(f"/api/matches/{match_id}/submit", json={"score": 30})
    two.post(f"/api/matches/{match_id}/submit", json={"score": 10})

    total = rating_of(module, "zero_a") + rating_of(module, "zero_b")
    assert total == 2000, f"ratings summed to {total}, not the 2000 they started with"


def test_an_equal_score_is_a_draw_and_moves_nobody(tmp_path):
    module = load(tmp_path)
    one, two = account(module, "draw_a"), account(module, "draw_b")
    match_id = matched(module, one, two)

    one.post(f"/api/matches/{match_id}/submit", json={"score": 20})
    two.post(f"/api/matches/{match_id}/submit", json={"score": 20})

    assert rating_of(module, "draw_a") == 1000
    assert rating_of(module, "draw_b") == 1000


def test_beating_a_stronger_player_is_worth_more(tmp_path):
    """The whole point of a rating: an upset has to pay better than a win
    everybody expected."""
    module = load(tmp_path)
    underdog = account(module, "underdog")
    favourite = account(module, "favourite")
    with module.app.app_context():
        strong = module.User.query.filter_by(username="favourite").first()
        strong.rating = 1400
        module.db.session.commit()

    match_id = matched(module, underdog, favourite)
    underdog.post(f"/api/matches/{match_id}/submit", json={"score": 40})
    favourite.post(f"/api/matches/{match_id}/submit", json={"score": 10})
    upset_gain = rating_of(module, "underdog") - 1000

    # The same win against an equal opponent, for comparison.
    even_a, even_b = account(module, "even_a"), account(module, "even_b")
    even_match = matched(module, even_a, even_b)
    even_a.post(f"/api/matches/{even_match}/submit", json={"score": 40})
    even_b.post(f"/api/matches/{even_match}/submit", json={"score": 10})
    expected_gain = rating_of(module, "even_a") - 1000

    assert upset_gain > expected_gain, f"upset paid {upset_gain}, routine win paid {expected_gain}"


def test_a_guest_match_is_not_rated(tmp_path):
    """A guest has no rating to lose, so rating these would let an account
    farm points off people who cannot lose any."""
    module = load(tmp_path)
    player = account(module, "farmer")
    visitor = guest(module)
    match_id = matched(module, player, visitor)

    player.post(f"/api/matches/{match_id}/submit", json={"score": 40})
    visitor.post(f"/api/matches/{match_id}/submit", json={"score": 5})

    assert rating_of(module, "farmer") == 1000, "farmed rating off a guest"


def test_forfeiting_is_a_loss(tmp_path):
    """Leaving on purpose is a decision, and it is scored like one."""
    module = load(tmp_path)
    stayer, quitter = account(module, "stayer"), account(module, "quitter")
    match_id = matched(module, stayer, quitter)

    socket = module.socketio.test_client(module.app, flask_test_client=quitter)
    socket.emit("join_match", {"match_id": match_id})
    socket.emit("leave_match", {"match_id": match_id})

    assert rating_of(module, "quitter") < 1000, "forfeiting cost nothing"
    assert rating_of(module, "stayer") > 1000, "the player who stayed gained nothing"


def test_a_dropped_connection_is_still_a_stalemate(tmp_path):
    """A match must not be winnable by outlasting somebody's wifi. This is the
    rule that separates a forfeit from a disconnect."""
    module = load(tmp_path)
    one, two = account(module, "online"), account(module, "dropped")
    match_id = matched(module, one, two)

    socket = module.socketio.test_client(module.app, flask_test_client=two)
    socket.emit("join_match", {"match_id": match_id})
    socket.disconnect()

    assert rating_of(module, "dropped") == 1000, "a disconnect cost rating"
    assert rating_of(module, "online") == 1000, "a disconnect handed out rating"


def test_the_winner_is_announced(tmp_path):
    module = load(tmp_path)
    one, two = account(module, "announce_a"), account(module, "announce_b")
    match_id = matched(module, one, two)

    listener = module.socketio.test_client(module.app, flask_test_client=one)
    listener.emit("join_match", {"match_id": match_id})
    listener.get_received()

    two.post(f"/api/matches/{match_id}/submit", json={"score": 9})
    one.post(f"/api/matches/{match_id}/submit", json={"score": 25})

    finished = [m for m in listener.get_received() if m["name"] == "match_finished"]
    assert finished, "no match_finished was broadcast"
    payload = finished[-1]["args"][0]
    assert payload["winner"] == "announce_a", payload
    assert payload["rated"] is True, payload


def test_a_huge_rating_gap_still_matches_when_nobody_better_is_waiting(tmp_path):
    """Rating is a preference, not a gate. A queue with one person in it has
    to pair with them however far apart the ratings are, or a small player
    base means nobody ever plays."""
    module = load(tmp_path)
    novice = account(module, "novice")
    veteran = account(module, "veteran")
    with module.app.app_context():
        strong = module.User.query.filter_by(username="veteran").first()
        strong.rating = 2200
        module.db.session.commit()

    first = novice.post("/api/matches/quick", json={"game_slug": "pushups"}).get_json()
    second = veteran.post("/api/matches/quick", json={"game_slug": "pushups"}).get_json()

    assert second["match_id"] == first["match_id"], "a 1200 point gap blocked the match"
    assert second["status"] == "active"


def test_the_closest_rating_is_preferred_when_there_is_a_choice(tmp_path):
    """...but given options, the near one wins. Both halves matter: prefer,
    then fall back. Two people queueing normally would pair with each other,
    so the two waiting rooms are built directly."""
    module = load(tmp_path)
    seeker = account(module, "seeker")
    with module.app.app_context():
        module.User.query.filter_by(username="seeker").first().rating = 1000
        game = module.Game.query.filter_by(slug="squats").first()

        waiting = {}
        for name, rating, code in (("far_away", 2000, "FARQUEUE"), ("near_by", 1010, "NEARQUE1")):
            user = module.User(username=name, password_hash="x", rating=rating)
            module.db.session.add(user)
            module.db.session.flush()
            room = module.Match(game_id=game.id, room_code=code, status="waiting")
            module.db.session.add(room)
            module.db.session.flush()
            module.db.session.add(module.MatchPlayer(
                match_id=room.id, user_id=user.id, display_name=name,
            ))
            waiting[name] = room.id
        module.db.session.commit()
        # Matchmaking will not offer a queue nobody has been seen sitting in,
        # and inserting the row directly skips the endpoint that would have
        # said so. The rival is meant to be there, so say it.
        for match_id in waiting.values():
            module.touch_match_presence(match_id)

    chosen = seeker.post("/api/matches/quick", json={"game_slug": "squats"}).get_json()

    assert chosen["match_id"] == waiting["near_by"], (
        f"paired into {chosen['match_id']} while the 1010 player waited in {waiting['near_by']}"
    )
