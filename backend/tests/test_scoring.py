"""Scores decide the ladder, so the server cannot take the client's word for
them. These cover what a submitted result is allowed to be."""

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


def matched_pair(module, one, two, slug="pushups"):
    first = one.post("/api/matches/quick", json={"game_slug": slug}).get_json()
    second = two.post("/api/matches/quick", json={"game_slug": slug}).get_json()
    assert first["match_id"] == second["match_id"], (first, second)
    return first["match_id"]


def test_an_impossible_score_is_rejected(tmp_path):
    """Nobody does ninety thousand push-ups in a minute. Accepting it would
    hand someone the top of the leaderboard from the browser console."""
    module = load(tmp_path)
    one = account(module, "cheater")
    two = account(module, "opponent_a")
    match_id = matched_pair(module, one, two)

    response = one.post(f"/api/matches/{match_id}/submit", json={"score": 90000})

    assert response.status_code == 400, response.get_data(as_text=True)
    assert "score" in response.get_json()["error"].lower()


def test_a_negative_score_is_rejected(tmp_path):
    module = load(tmp_path)
    one = account(module, "negative")
    two = account(module, "opponent_b")
    match_id = matched_pair(module, one, two)

    response = one.post(f"/api/matches/{match_id}/submit", json={"score": -5})

    assert response.status_code == 400, response.get_data(as_text=True)


def test_a_real_score_is_accepted_and_reaches_the_leaderboard(tmp_path):
    module = load(tmp_path)
    one = account(module, "honest")
    two = account(module, "opponent_c")
    match_id = matched_pair(module, one, two)

    accepted = one.post(f"/api/matches/{match_id}/submit", json={"score": 32})
    assert accepted.status_code == 200, accepted.get_data(as_text=True)

    board = module.app.test_client().get("/api/leaderboard/pushups").get_json()
    entry = next((row for row in board if row["username"] == "honest"), None)

    assert entry is not None, board
    assert entry["score"] == 32


def test_a_score_cannot_be_resubmitted(tmp_path):
    """Both results are broadcast when the match ends. Without this you could
    watch your opponent's number and then send a better one."""
    module = load(tmp_path)
    one = account(module, "resubmit")
    two = account(module, "opponent_d")
    match_id = matched_pair(module, one, two)

    assert one.post(f"/api/matches/{match_id}/submit", json={"score": 10}).status_code == 200
    second = one.post(f"/api/matches/{match_id}/submit", json={"score": 99})

    assert second.status_code == 400, second.get_data(as_text=True)
    board = module.app.test_client().get("/api/leaderboard/pushups").get_json()
    entry = next(row for row in board if row["username"] == "resubmit")
    assert entry["score"] == 10, "the improved score was accepted anyway"


def test_a_stranger_cannot_submit_to_someone_elses_match(tmp_path):
    module = load(tmp_path)
    one = account(module, "player_one")
    two = account(module, "player_two")
    outsider = account(module, "outsider")
    match_id = matched_pair(module, one, two)

    response = outsider.post(f"/api/matches/{match_id}/submit", json={"score": 5})

    assert response.status_code == 403, response.get_data(as_text=True)


def test_both_results_finish_the_match(tmp_path):
    module = load(tmp_path)
    one = account(module, "finisher_a")
    two = account(module, "finisher_b")
    match_id = matched_pair(module, one, two)

    one.post(f"/api/matches/{match_id}/submit", json={"score": 12})
    two.post(f"/api/matches/{match_id}/submit", json={"score": 18})

    with module.app.app_context():
        match = module.db.session.get(module.Match, match_id)
        assert match.status == "finished"
        assert match.finished_at is not None
