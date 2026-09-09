"""Random video chat puts strangers on camera together. Being able to end that
and not have it repeat is part of the product, not a policy checkbox -- and
both app stores require it before they will list an app like this."""

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


def paired(module, one, two, slug="pushups"):
    first = one.post("/api/matches/quick", json={"game_slug": slug}).get_json()
    second = two.post("/api/matches/quick", json={"game_slug": slug}).get_json()
    assert first["match_id"] == second["match_id"], (first, second)
    return first["match_id"]


def players(module, match_id):
    with module.app.app_context():
        return [p.id for p in module.MatchPlayer.query.filter_by(match_id=match_id).all()]


def test_blocking_stops_you_being_paired_again(tmp_path):
    """The whole point. A block that matchmaking ignores is a button that
    lies."""
    module = load(tmp_path)
    me, them = guest(module), guest(module)
    match_id = paired(module, me, them)
    theirs = players(module, match_id)[1]

    assert me.post("/api/blocks", json={"match_id": match_id, "player_id": theirs}).status_code == 200

    # Both leave and queue again. They must not find each other.
    me.post("/api/matches/quick/cancel", json={"game_slug": "pushups"})
    them.post("/api/matches/quick/cancel", json={"game_slug": "pushups"})
    with module.app.app_context():
        for match in module.Match.query.all():
            module.MatchPlayer.query.filter_by(match_id=match.id).delete()
            module.db.session.delete(match)
        module.db.session.commit()

    theirs_again = them.post("/api/matches/quick", json={"game_slug": "pushups"}).get_json()
    mine_again = me.post("/api/matches/quick", json={"game_slug": "pushups"}).get_json()

    assert mine_again["match_id"] != theirs_again["match_id"], "paired with a blocked player"


def test_a_block_works_in_both_directions(tmp_path):
    """The half people forget: only one of you has to have pressed the button,
    and being paired with somebody who blocked you is exactly as bad."""
    module = load(tmp_path)
    blocker, blocked = guest(module), guest(module)
    match_id = paired(module, blocker, blocked)
    target = players(module, match_id)[1]
    blocker.post("/api/blocks", json={"match_id": match_id, "player_id": target})

    with module.app.app_context():
        for match in module.Match.query.all():
            module.MatchPlayer.query.filter_by(match_id=match.id).delete()
            module.db.session.delete(match)
        module.db.session.commit()

    # The blocked person queues first this time.
    theirs = blocked.post("/api/matches/quick", json={"game_slug": "pushups"}).get_json()
    mine = blocker.post("/api/matches/quick", json={"game_slug": "pushups"}).get_json()

    assert mine["match_id"] != theirs["match_id"], "the block only worked one way"


def test_a_blocked_room_is_not_offered_in_browse(tmp_path):
    """Random picks from the same list Browse renders, so one filter covers
    both ways into a room."""
    module = load(tmp_path)
    host, me = guest(module), guest(module)
    room = host.post("/api/rooms", json={"game_slug": "groupchat", "name": "theirs"}).get_json()
    joined = host.post(f"/api/rooms/{room['code']}/join").get_json()
    me.post(f"/api/rooms/{room['code']}/join")
    theirs = players(module, joined["match_id"])[0]

    assert room["code"] in [r["code"] for r in me.get("/api/rooms").get_json()]

    me.post("/api/blocks", json={"match_id": joined["match_id"], "player_id": theirs})

    assert room["code"] not in [r["code"] for r in me.get("/api/rooms").get_json()]
    # ...but everyone else still sees it.
    assert room["code"] in [r["code"] for r in guest(module).get("/api/rooms").get_json()]


def test_you_cannot_block_yourself(tmp_path):
    module = load(tmp_path)
    me, them = guest(module), guest(module)
    match_id = paired(module, me, them)
    mine = players(module, match_id)[0]

    response = me.post("/api/blocks", json={"match_id": match_id, "player_id": mine})

    assert response.status_code == 400, response.get_data(as_text=True)


def test_reporting_records_and_blocks(tmp_path):
    """Reporting somebody you are on camera with is a request to get away from
    them. Making that two actions means the second gets forgotten."""
    module = load(tmp_path)
    me, them = guest(module), guest(module)
    match_id = paired(module, me, them)
    theirs = players(module, match_id)[1]

    response = me.post("/api/reports", json={
        "match_id": match_id, "player_id": theirs, "reason": "harassment",
    })

    assert response.status_code == 200, response.get_data(as_text=True)
    assert response.get_json()["blocked"] is True
    with module.app.app_context():
        report = module.Report.query.first()
        assert report is not None and report.reason == "harassment"
        assert module.Block.query.count() == 1, "reporting did not block"


def test_an_invented_reason_is_refused(tmp_path):
    module = load(tmp_path)
    me, them = guest(module), guest(module)
    match_id = paired(module, me, them)
    theirs = players(module, match_id)[1]

    response = me.post("/api/reports", json={
        "match_id": match_id, "player_id": theirs, "reason": "because",
    })

    assert response.status_code == 400


def test_blocking_twice_records_one_block(tmp_path):
    module = load(tmp_path)
    me, them = guest(module), guest(module)
    match_id = paired(module, me, them)
    theirs = players(module, match_id)[1]

    me.post("/api/blocks", json={"match_id": match_id, "player_id": theirs})
    me.post("/api/blocks", json={"match_id": match_id, "player_id": theirs})

    with module.app.app_context():
        assert module.Block.query.count() == 1


def test_blocking_somebody_not_in_the_match_is_refused(tmp_path):
    module = load(tmp_path)
    me, them = guest(module), guest(module)
    match_id = paired(module, me, them)

    response = me.post("/api/blocks", json={"match_id": match_id, "player_id": 99999})

    assert response.status_code == 400


def test_you_cannot_report_a_match_you_were_never_in(tmp_path):
    """Both endpoints checked the target was in the match and never that the
    reporter was, so anyone could pile reports on anyone in any match id they
    could guess. That was survivable while nothing read the reports. There is
    a moderation queue now, and a queue full of invented reports is worse than
    no queue at all."""
    module = load(tmp_path)
    one, two = guest(module), guest(module)
    match_id = paired(module, one, two)
    victim = players(module, match_id)[1]

    outsider = guest(module)
    response = outsider.post("/api/reports", json={
        "match_id": match_id, "player_id": victim, "reason": "harassment",
    })
    assert response.status_code == 403, response.get_data(as_text=True)

    with module.app.app_context():
        assert module.Report.query.count() == 0, "a stranger filed a report"


def test_you_cannot_block_through_a_match_you_were_never_in(tmp_path):
    module = load(tmp_path)
    one, two = guest(module), guest(module)
    match_id = paired(module, one, two)
    target = players(module, match_id)[1]

    outsider = guest(module)
    assert outsider.post("/api/blocks", json={
        "match_id": match_id, "player_id": target,
    }).status_code == 403


def test_someone_who_was_there_still_can(tmp_path):
    """The check must not break the feature it protects."""
    module = load(tmp_path)
    one, two = guest(module), guest(module)
    match_id = paired(module, one, two)
    theirs = players(module, match_id)[1]

    response = one.post("/api/reports", json={
        "match_id": match_id, "player_id": theirs, "reason": "harassment",
    })
    assert response.status_code == 200, response.get_data(as_text=True)


def test_reporting_is_rate_limited(tmp_path):
    """One script could otherwise fill the table and bury the real ones."""
    module = load(tmp_path)
    assert module.REPORT_MAX_PER_WINDOW < 100, "a ceiling that high is not a ceiling"
    one, two = guest(module), guest(module)
    match_id = paired(module, one, two)
    theirs = players(module, match_id)[1]

    codes = set()
    for _ in range(module.REPORT_MAX_PER_WINDOW + 5):
        codes.add(one.post("/api/reports", json={
            "match_id": match_id, "player_id": theirs, "reason": "spam",
        }).status_code)
    assert 429 in codes, codes
