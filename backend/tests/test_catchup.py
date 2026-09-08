"""A reason to come back.

The app had nothing to say to somebody who already left. This is the smallest
honest version: your rating moved, or somebody passed you on the ladder. The
rule that matters is that it never invents drama -- a page refresh is not a
return, an untouched account is not a rival, and a rank nobody earned is not
a rank.

Every assertion here is relative -- a rank moved by one, a total did not grow.
The whole suite shares one database, so accounts from earlier tests are still
on the ladder and no absolute position is stable.
"""

import importlib
import json
import os
from datetime import datetime, timedelta


def load(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    return importlib.import_module("app")


def account(module, name):
    client = module.app.test_client()
    client.post("/api/auth/register", json={
        "username": name, "email": f"{name}@x.com", "password": "pw12345678",
    })
    return client


def catchup(client):
    return client.post("/api/me/catchup").get_json()


def played(module, username, rating, games=1):
    """Give somebody a rating that counts, which means matches behind it."""
    with module.app.app_context():
        user = module.User.query.filter_by(username=username).first()
        user.rating = rating
        game = module.Game.query.filter_by(slug="pushups").first()
        for _ in range(games):
            match = module.Match(
                game_id=game.id, room_code=module.gen_room_code(), status="finished",
            )
            module.db.session.add(match)
            module.db.session.flush()
            module.db.session.add(module.MatchPlayer(
                match_id=match.id, user_id=user.id, display_name=username,
            ))
        module.db.session.commit()


def send_back_in_time(module, username, minutes):
    """Age the stored visit, which is the only way to be away in a test."""
    with module.app.app_context():
        user = module.User.query.filter_by(username=username).first()
        prefs = user.prefs()
        moved = datetime.utcnow() - timedelta(minutes=minutes)
        prefs["seen_at"] = moved.isoformat()
        if prefs.get("ladder_mark"):
            prefs["ladder_mark"]["at"] = moved.isoformat()
        user.set_prefs(prefs)
        module.db.session.commit()


def test_a_first_visit_has_nothing_to_report(tmp_path):
    module = load(tmp_path)
    client = account(module, "newcomer")
    played(module, "newcomer", 1000)

    first = catchup(client)
    assert first["returning"] is False
    assert first["rank"] is not None


def test_a_refresh_is_not_a_return(tmp_path):
    """The whole feature is worthless if it fires every time the page loads."""
    module = load(tmp_path)
    client = account(module, "refresher")
    played(module, "refresher", 1000)

    catchup(client)
    for _ in range(3):
        assert catchup(client)["returning"] is False


def test_coming_back_says_who_passed_you(tmp_path):
    module = load(tmp_path)
    me = account(module, "champ")
    account(module, "rival")
    played(module, "champ", 1200)
    played(module, "rival", 1100)

    before = catchup(me)["rank"]

    # Away long enough to count, and overtaken while gone.
    send_back_in_time(module, "champ", module.AWAY_RESET_MINUTES + 5)
    played(module, "rival", 1300)

    back = catchup(me)
    assert back["returning"] is True
    assert back["rank"] == before + 1 and back["previous_rank"] == before
    assert back["passed_by"] == ["rival"]


def test_it_does_not_invent_a_rival_who_was_always_ahead(tmp_path):
    """Somebody who was already above you did not pass you."""
    module = load(tmp_path)
    me = account(module, "second")
    account(module, "leader")
    played(module, "second", 1000)
    played(module, "leader", 1500)

    catchup(me)
    send_back_in_time(module, "second", module.AWAY_RESET_MINUTES + 5)

    back = catchup(me)
    assert back["returning"] is True
    assert back["passed_by"] == []


def test_holding_your_place_reports_no_one(tmp_path):
    module = load(tmp_path)
    me = account(module, "holder")
    account(module, "chaser")
    played(module, "holder", 1400)
    played(module, "chaser", 1100)

    catchup(me)
    send_back_in_time(module, "holder", module.AWAY_RESET_MINUTES + 5)

    back = catchup(me)
    assert back["returning"] is True
    assert back["rank"] == back["previous_rank"]
    assert back["passed_by"] == []
    assert back["rating_change"] == 0


def test_a_rating_change_is_reported(tmp_path):
    module = load(tmp_path)
    me = account(module, "climber")
    played(module, "climber", 1000)

    catchup(me)
    send_back_in_time(module, "climber", module.AWAY_RESET_MINUTES + 5)
    played(module, "climber", 1080)

    assert catchup(me)["rating_change"] == 80


def test_accounts_that_never_played_are_not_on_the_ladder(tmp_path):
    """Hundreds of untouched 1000s would make every rank meaningless."""
    module = load(tmp_path)
    me = account(module, "player")
    played(module, "player", 1000)
    before = catchup(me)["players_ranked"]

    for name in ("lurker1", "lurker2", "lurker3"):
        account(module, name)

    assert catchup(me)["players_ranked"] == before


def test_a_guest_has_no_ladder_to_come_back_to(tmp_path):
    module = load(tmp_path)
    client = module.app.test_client()
    client.post("/api/auth/guest")
    assert client.post("/api/me/catchup").status_code in (401, 403)
