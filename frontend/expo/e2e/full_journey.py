#!/usr/bin/env python3
"""Trap Chat — end-to-end journeys.

The other suites prove pieces: matchmaking pairs, the scorer scores, the vote
API accepts a vote. This drives the paths a person actually takes, with two
real browsers, through to a result. It exists because "every test passes" and
"the app works" are different claims.

    python e2e/full_journey.py                 # against a local build
    python e2e/full_journey.py https://<host>/

Requires: pip install playwright && playwright install chromium
"""

from playwright.sync_api import sync_playwright
import sys
import time

APP = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100/"
res = []


def check(name, ok, detail=""):
    res.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  |  {detail[:150]}" if detail else ""), flush=True)


def body(page):
    return page.inner_text("body")


def one_line(page, n=120):
    return body(page)[:n].replace("\n", " | ")


def guest(browser, name):
    page = browser.new_context(
        viewport={"width": 430, "height": 900},
        is_mobile=True,
        has_touch=True,
        permissions=["camera", "microphone"],
    ).new_page()
    page.goto(APP, wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(2500)
    page.fill("input[placeholder='Pick a name (optional)']", name)
    page.get_by_text("Continue as guest", exact=True).click()
    page.wait_for_timeout(4500)
    return page


def to_competitive(page):
    page.locator('[aria-label="Open menu"]').first.click()
    page.wait_for_timeout(700)
    page.locator('[aria-label="Competitive"]').last.click()
    page.wait_for_timeout(1200)


def to_random(page):
    page.locator('[aria-label="Open menu"]').first.click()
    page.wait_for_timeout(700)
    page.locator('[aria-label="Random"]').last.click()
    page.wait_for_timeout(1200)


with sync_playwright() as p:
    browser = p.chromium.launch(
        args=[
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
        ]
    )
    t = int(time.time())
    errors = []

    # ---------- JOURNEY 1: A RAP BATTLE, PLAYED AND JUDGED ----------
    one = guest(browser, f"mc{t}")
    two = guest(browser, f"dj{t}")
    for page in (one, two):
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    to_competitive(one)
    one.get_by_text("Rap Battle", exact=True).click()
    one.wait_for_timeout(3000)
    to_competitive(two)
    two.get_by_text("Rap Battle", exact=True).click()
    two.wait_for_timeout(6000)
    one.wait_for_timeout(3000)

    paired = "Pick a beat" in body(one) and "Pick a beat" in body(two)
    check("both rappers reach the beat picker", paired, one_line(one))

    if not paired:
        print("SKIP  the rest of the battle: the pair never formed", flush=True)
    else:
        # A beat has to be choosable, and the choice has to stick.
        one.get_by_text("Trap", exact=True).first.click()
        one.wait_for_timeout(600)
        check("a beat can be selected", "140 BPM" in body(one), one_line(one))

        for page in (one, two):
            page.get_by_text("Use ", exact=False).first.click()
            page.wait_for_timeout(1200)
        check("choosing a beat opens the turn", "Start my turn" in body(one), one_line(one))

        # The turn itself: mic, beat and meter running.
        for page in (one, two):
            page.get_by_text("Start my turn", exact=True).click()
            page.wait_for_timeout(4000)
        running = "bars" in body(one) and ("ON BEAT" in body(one) or "OFF BEAT" in body(one) or "CLOSE" in body(one))
        check("the turn runs with a live meter", running, one_line(one))

        # End early rather than waiting out sixty seconds.
        for page in (one, two):
            page.get_by_text("End my turn", exact=True).click()
            page.wait_for_timeout(3500)
        check("ending the turn reaches the vote", "The room decides" in body(one), one_line(one))
        check("the flow score is reported", "YOUR FLOW" in body(one), one_line(one, 200))

        # Voting. Each side votes for the other; nobody may vote for themselves.
        check("you cannot vote for yourself", "That is you" in body(one), one_line(one, 200))
        # If an earlier suite left a guest queued, this browser paired with
        # that ghost instead of its own partner and every check below would be
        # measuring the wrong match.
        check("the two browsers are in the same battle",
              f"dj{t}" in body(one), one_line(one, 220))

        votes = one.get_by_text("Vote", exact=True)
        if votes.count():
            votes.first.click()
            one.wait_for_timeout(2500)
            check("a vote registers", "Your vote" in body(one), one_line(one, 200))

            two.wait_for_timeout(2000)
            check("the tally reaches the other browser live",
                  "1 vote" in body(two), one_line(two, 220))
        else:
            check("a vote button is offered", False, one_line(one, 200))

    # ---------- JOURNEY 2: A LOOKS BATTLE, WHICH IS ONLY A VOTE ----------
    lx = guest(browser, f"lx{t}")
    ly = guest(browser, f"ly{t}")
    to_competitive(lx)
    lx.get_by_text("Looks Battle", exact=True).click()
    lx.wait_for_timeout(3000)
    to_competitive(ly)
    ly.get_by_text("Looks Battle", exact=True).click()
    ly.wait_for_timeout(7000)
    lx.wait_for_timeout(2000)

    in_looks = "Go to the vote" in body(lx) and "Go to the vote" in body(ly)
    check("a looks battle opens its own showcase", in_looks, one_line(lx))

    if in_looks:
        for page in (lx, ly):
            page.get_by_text("Go to the vote", exact=True).click()
            page.wait_for_timeout(3000)
        check("the showcase leads to a vote", "The room decides" in body(lx), one_line(lx))
        check("the two browsers are in the same looks battle",
              f"ly{t}" in body(lx), one_line(lx, 220))
        check("looks battle offers no fake score",
              "YOUR FLOW" not in body(lx), one_line(lx, 200))

        looks_votes = lx.get_by_text("Vote", exact=True)
        if looks_votes.count():
            looks_votes.first.click()
            lx.wait_for_timeout(2500)
            check("a looks vote registers", "Your vote" in body(lx), one_line(lx, 200))
            ly.wait_for_timeout(2000)
            check("the looks tally reaches the other browser",
                  "1 vote" in body(ly), one_line(ly, 220))
        else:
            check("a looks vote button is offered", False, one_line(lx, 200))

    # ---------- JOURNEY 3: TWO STRANGERS IN A SOCIAL CHAT ----------
    a = guest(browser, f"sa{t}")
    b = guest(browser, f"sb{t}")
    to_random(a)
    a.get_by_text("Start", exact=True).click()
    a.wait_for_timeout(6000)
    to_random(b)
    b.get_by_text("Start", exact=True).click()
    b.wait_for_timeout(7000)
    a.wait_for_timeout(2000)

    together = "Swipe up to skip" in body(a) and "Swipe up to skip" in body(b)
    check("two strangers land in a room", together,
          ("A: " + one_line(a, 60) + " || B: " + one_line(b, 60)))

    if together:
        a.fill("input[placeholder='Add comment...']", "yo")
        a.get_by_text("Post", exact=True).click()
        a.wait_for_timeout(2500)
        check("a message relays to the other browser", "yo" in body(b), one_line(b, 200))

        # Leaving has to actually leave.
        b.get_by_text("Leave", exact=True).last.click()
        b.wait_for_timeout(2500)
        check("leaving returns you to the start screen",
              "Start" in body(b) and "Swipe up to skip" not in body(b), one_line(b, 120))

    print("\n=== console errors ===")
    for e in errors[:6]:
        print("  ", e[:150])

    browser.close()

print("\n" + "=" * 60)
bad = [n for n, ok, _ in res if not ok]
print(f"{len(res) - len(bad)}/{len(res)} passed")
if bad:
    print("FAILED:")
    for name in bad:
        print(f"  - {name}")
raise SystemExit(1 if bad else 0)
