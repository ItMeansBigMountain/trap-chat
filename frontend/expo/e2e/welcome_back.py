#!/usr/bin/env python3
"""Trap Chat -- the reason to come back.

The app had nothing to say to somebody who already left. This drives the one
thing it says now: your place on the ladder moved while you were away, and
here is who moved it.

Two halves, deliberately split. *When* it speaks is a backend rule and is
pinned in backend/tests/test_catchup.py, where a visit can be aged by thirty
minutes without waiting thirty minutes. Faking that from a browser would have
meant a rating-setting endpoint living in production forever, which is not a
trade worth making for a test. So the quiet cases here run against the real
endpoint, and the ones that need history stub the response and check the only
thing left to get wrong: that the sentence on screen matches the facts.

    python e2e/welcome_back.py                 # against a local build
    python e2e/welcome_back.py https://<host>/

Requires: pip install playwright && playwright install chromium
"""

from playwright.sync_api import sync_playwright
import json
import sys
import time

APP = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100/"
res = []


def check(name, ok, detail=""):
    res.append((name, ok, detail))
    line = f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  |  {detail[:150]}" if detail else "")
    # Emoji in the app, cp1252 in the console. Printing raw ended the run.
    print(line.encode("ascii", "replace").decode("ascii"), flush=True)


def body(page):
    return page.inner_text("body")


def register(browser, username, password="pw12345678"):
    page = browser.new_context(
        viewport={"width": 430, "height": 900}, is_mobile=True, has_touch=True,
        permissions=["camera", "microphone"],
    ).new_page()
    page.goto(APP, wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(2500)
    page.get_by_label("Username").fill(username)
    page.get_by_label("Password").fill(password)
    page.get_by_text("Create account", exact=True).click()
    page.wait_for_timeout(4500)
    return page


def to_competitive(page):
    page.locator('[aria-label="Open menu"]').first.click()
    page.wait_for_timeout(700)
    page.locator('[aria-label="Competitive"]').last.click()
    page.wait_for_timeout(2500)


def cors_for(request):
    """Headers a stubbed cross-origin reply needs to survive the browser.

    The app sends credentials, so a wildcard origin is rejected outright and
    the response is discarded before any code sees it -- which looks exactly
    like a feature that does not work. The origin has to be echoed back, and
    the preflight answered with the same.
    """
    return {
        "Access-Control-Allow-Origin": request.headers.get("origin", "*"),
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type, authorization, x-guest-session",
    }


def say(page, payload):
    """Answer the catch-up call with a fixed history."""
    def handler(route, request):
        if request.method == "OPTIONS":
            route.fulfill(status=204, headers=cors_for(request))
            return
        route.fulfill(status=200, content_type="application/json",
                      headers=cors_for(request), body=json.dumps(payload))

    page.unroute("**/api/me/catchup")
    page.route("**/api/me/catchup", handler)


def reopen(page):
    """Back to Competitive from scratch, which is when it asks."""
    page.reload(wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(3000)
    to_competitive(page)
    return body(page)


BASE = {"returning": True, "rank": 7, "rating": 1180, "players_ranked": 42,
        "away_seconds": 3 * 86400, "previous_rank": 4, "rating_change": -20,
        "passed_by": []}


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-fake-ui-for-media-stream",
                                      "--use-fake-device-for-media-stream"])
    page = register(browser, f"wb{int(time.time())}")
    check("an account reaches the app",
          "Trap Chat" not in body(page) or "Random" in body(page),
          body(page)[:100].replace("\n", " | "))

    # Against the real endpoint: a new account has no history, so there is
    # nothing to announce. This is the case that would be most tempting to
    # fill with something, and it has to stay empty.
    to_competitive(page)
    first = body(page)
    check("a first visit announces nothing",
          "passed you" not in first and "held your place" not in first,
          first[:160].replace("\n", " | "))

    # Nor does reloading. A banner that fires on every page load is noise, and
    # this is the failure mode the whole feature lives or dies on.
    check("a refresh is not a return", "passed you" not in reopen(page),
          body(page)[:160].replace("\n", " | "))

    # One rival, named.
    say(page, {**BASE, "passed_by": ["nadia"]})
    one = reopen(page)
    check("it names the one player who passed you", "nadia passed you" in one,
          one[:200].replace("\n", " | "))
    check("it shows the places lost", "#4" in one and "#7" in one,
          one[:200].replace("\n", " | "))
    check("it says how long you were gone, in the past tense",
          "in the last 3 days" in one,
          one[:200].replace("\n", " | "))

    # Several rivals are counted, not listed: a wall of names is not a nudge.
    say(page, {**BASE, "passed_by": ["nadia", "kofi", "sam"]})
    many = reopen(page)
    check("several players are counted rather than listed",
          "3 players passed you" in many, many[:200].replace("\n", " | "))

    # Nobody passed and the rating moved up: say that instead.
    say(page, {**BASE, "rank": 4, "previous_rank": 4, "rating_change": 35})
    up = reopen(page)
    check("a gain is reported when nobody passed you",
          "gained 35 rating" in up, up[:200].replace("\n", " | "))

    # Nothing happened at all. It still must not invent anything.
    say(page, {**BASE, "rank": 4, "previous_rank": 4, "rating_change": 0})
    flat = reopen(page)
    check("holding your place is said plainly, not dressed up",
          "held your place" in flat and "passed you" not in flat,
          flat[:200].replace("\n", " | "))

    # And it can be got rid of.
    page.get_by_label("Dismiss").first.click()
    page.wait_for_timeout(800)
    check("it can be dismissed", "held your place" not in body(page),
          body(page)[:160].replace("\n", " | "))

    browser.close()

print("\n" + "=" * 60)
bad = [n for n, ok, _ in res if not ok]
print(f"{len(res) - len(bad)}/{len(res)} passed")
if bad:
    print("FAILED:")
    for name in bad:
        print(f"  - {name}")
raise SystemExit(1 if bad else 0)
