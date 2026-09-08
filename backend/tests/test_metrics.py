"""Nothing was measured before this, so every decision about frequency,
retention or whether TURN is worth paying for was a guess. These pin what the
counters are allowed to accept and what they report."""

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


def test_an_event_is_recorded_and_counted(tmp_path):
    module = load(tmp_path)
    client = guest(module)

    assert client.post("/api/metrics", json={"name": "webrtc_connected"}).status_code == 200

    summary = client.get("/api/metrics/summary").get_json()
    assert summary["day"]["webrtc_connected"]["total"] == 1
    assert summary["day"]["webrtc_connected"]["guest"] == 1


def test_an_unknown_event_is_refused(tmp_path):
    """An open-ended name lets anyone fill the table with anything, and an
    unbounded set of names cannot be queried anyway."""
    module = load(tmp_path)

    response = guest(module).post("/api/metrics", json={"name": "whatever_i_like"})

    assert response.status_code == 400, response.get_data(as_text=True)


def test_guests_and_accounts_are_counted_apart(tmp_path):
    """The whole point of splitting them: guests are expected to behave
    differently, and a single total hides it."""
    module = load(tmp_path)
    guest(module).post("/api/metrics", json={"name": "social_started"})

    account = module.app.test_client()
    account.post("/api/auth/register", json={"username": "measured", "password": "Str0ng-Pass!1"})
    account.post("/api/metrics", json={"name": "social_started"})

    counts = account.get("/api/metrics/summary").get_json()["day"]["social_started"]
    assert counts == {"total": 2, "guest": 1, "account": 1}, counts


def test_the_webrtc_failure_rate_is_reported(tmp_path):
    """The number that decides whether TURN is worth paying for."""
    module = load(tmp_path)
    client = guest(module)
    for _ in range(3):
        client.post("/api/metrics", json={"name": "webrtc_connected"})
    client.post("/api/metrics", json={"name": "webrtc_failed"})

    summary = client.get("/api/metrics/summary").get_json()

    assert summary["webrtc_attempts_week"] == 4
    assert summary["webrtc_failure_rate_week"] == 0.25


def test_no_calls_yet_reports_no_rate_rather_than_zero(tmp_path):
    """Zero would read as "nothing ever fails", which is a different and much
    more dangerous claim than "nobody has tried"."""
    module = load(tmp_path)

    summary = guest(module).get("/api/metrics/summary").get_json()

    assert summary["webrtc_failure_rate_week"] is None
    assert summary["webrtc_attempts_week"] == 0


def test_metadata_has_to_be_an_object(tmp_path):
    module = load(tmp_path)
    response = guest(module).post("/api/metrics", json={"name": "queue_joined", "meta": "nope"})
    assert response.status_code == 400


def test_reporting_is_rate_limited(tmp_path):
    """One tab must not be able to fill the table."""
    module = load(tmp_path)
    client = guest(module)

    codes = [
        client.post("/api/metrics", json={"name": "social_skipped"}).status_code
        for _ in range(module.MAX_EVENTS_PER_MINUTE + 5)
    ]

    assert 429 in codes, "reporting was never throttled"


def test_old_events_are_pruned(tmp_path):
    """The table lives in a SQLite file on a share; it cannot grow forever."""
    from datetime import datetime, timedelta

    module = load(tmp_path)
    client = guest(module)
    client.post("/api/metrics", json={"name": "match_started"})

    with module.app.app_context():
        old = module.Event.query.first()
        old.at = datetime.utcnow() - timedelta(days=module.EVENT_RETENTION_DAYS + 1)
        module.db.session.commit()

    client.get("/api/metrics/summary")

    with module.app.app_context():
        assert module.Event.query.count() == 0, "an expired event survived"
