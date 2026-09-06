"""Rap Battle and Looks Battle have no objective score, so the room decides.
These pin who is allowed to vote, and what a vote is worth."""

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


def battle(module, slug="rapbattle"):
    """Two guests matched into a judged battle, and the player rows for each."""
    one, two = guest(module), guest(module)
    first = one.post("/api/matches/quick", json={"game_slug": slug}).get_json()
    second = two.post("/api/matches/quick", json={"game_slug": slug}).get_json()
    assert first["match_id"] == second["match_id"], (first, second)
    match_id = first["match_id"]
    tally = one.get(f"/api/matches/{match_id}/votes").get_json()["tally"]
    return one, two, match_id, tally


def test_a_competitor_can_vote_for_their_opponent(tmp_path):
    module = load(tmp_path)
    one, two, match_id, _ = battle(module)
    with module.app.app_context():
        # "one" queued first, so the second row is the opponent. Picking by
        # position in the tally would let this pass for the wrong reason.
        opponent = module.MatchPlayer.query.filter_by(match_id=match_id).all()[1].id

    response = one.post(f"/api/matches/{match_id}/vote", json={"for_player_id": opponent})

    assert response.status_code == 200, response.get_data(as_text=True)
    counted = {row["player_id"]: row["votes"] for row in response.get_json()["tally"]}
    assert counted[opponent] == 1
    assert sum(counted.values()) == 1


def test_you_cannot_vote_for_yourself(tmp_path):
    """A vote you can cast for yourself is not a vote, it is a button."""
    module = load(tmp_path)
    one, two, match_id, tally = battle(module)
    with module.app.app_context():
        players = module.MatchPlayer.query.filter_by(match_id=match_id).all()
        me = players[0].id

    response = one.post(f"/api/matches/{match_id}/vote", json={"for_player_id": me})

    assert response.status_code == 400, response.get_data(as_text=True)
    assert "yourself" in response.get_json()["error"]


def test_voting_twice_changes_your_vote_rather_than_adding_one(tmp_path):
    module = load(tmp_path)
    one, two, match_id, _ = battle(module)
    with module.app.app_context():
        players = module.MatchPlayer.query.filter_by(match_id=match_id).all()
        opponent = players[1].id

    one.post(f"/api/matches/{match_id}/vote", json={"for_player_id": opponent})
    again = one.post(f"/api/matches/{match_id}/vote", json={"for_player_id": opponent})

    total = sum(row["votes"] for row in again.get_json()["tally"])
    assert total == 1, again.get_json()["tally"]


def test_an_audience_member_who_is_not_competing_can_vote(tmp_path):
    """The audience is the point. Someone watching has no player row of their
    own, and must still be able to score the battle."""
    module = load(tmp_path)
    one, two, match_id, _ = battle(module)
    with module.app.app_context():
        players = module.MatchPlayer.query.filter_by(match_id=match_id).all()
        first = players[0].id

    watcher = guest(module)
    response = watcher.post(f"/api/matches/{match_id}/vote", json={"for_player_id": first})

    assert response.status_code == 200, response.get_data(as_text=True)
    counted = {row["player_id"]: row["votes"] for row in response.get_json()["tally"]}
    assert counted[first] == 1


def test_a_game_with_a_real_score_is_not_put_to_a_vote(tmp_path):
    """Push-ups have a number. Letting the room overrule it would make the
    leaderboard meaningless."""
    module = load(tmp_path)
    one, two, match_id, _ = battle(module, slug="pushups")
    with module.app.app_context():
        players = module.MatchPlayer.query.filter_by(match_id=match_id).all()
        opponent = players[1].id

    response = one.post(f"/api/matches/{match_id}/vote", json={"for_player_id": opponent})

    assert response.status_code == 400, response.get_data(as_text=True)


def test_the_tally_lists_everyone_including_nil(tmp_path):
    """A battle where one side has no votes still has to show that side."""
    module = load(tmp_path)
    one, two, match_id, _ = battle(module)

    tally = one.get(f"/api/matches/{match_id}/votes").get_json()["tally"]

    assert len(tally) == 2, tally
    assert all(row["votes"] == 0 for row in tally)
    assert all(row["display_name"] for row in tally)


def test_a_vote_cannot_be_cast_for_someone_in_another_battle(tmp_path):
    module = load(tmp_path)
    one, two, match_id, _ = battle(module)
    _, _, other_match, _ = battle(module)
    with module.app.app_context():
        outsider = module.MatchPlayer.query.filter_by(match_id=other_match).first().id

    response = one.post(f"/api/matches/{match_id}/vote", json={"for_player_id": outsider})

    assert response.status_code == 400, response.get_data(as_text=True)
