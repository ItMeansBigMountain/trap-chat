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


def close(*pages):
    """Give a journey's browsers back.

    This file opens nine contexts, each running WebRTC and a pose or face
    model. Left open they all stay resident, and on a two-core CI runner the
    renderer eventually dies -- which shows up as "waiting for locator(body)"
    thirty seconds later, in a completely different journey to the one that
    caused it.
    """
    for page in pages:
        try:
            page.context.close()
        except Exception:
            pass  # Already gone. Nothing to reclaim.


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

    # Rap Battle is built and tested at the API level, but it is held back
    # from the board until it has a turn structure, so no browser journey can
    # reach it. Its leg comes back when the game does.
    one = guest(browser, f"mc{t}")
    one.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    # ---------- JOURNEY 1b: A RANKED MATCH THAT SOMEBODY WINS ----------
    # Push-ups is the game with a number attached, so it is the one that has
    # to end with a winner rather than two scores sitting side by side.
    ra = guest(browser, f"ra{t}")
    rb = guest(browser, f"rb{t}")
    rb.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    to_competitive(ra)
    ra.get_by_text("Push-Ups", exact=True).click()
    ra.wait_for_timeout(3000)
    to_competitive(rb)
    rb.get_by_text("Push-Ups", exact=True).click()
    rb.wait_for_timeout(7000)
    ra.wait_for_timeout(2500)

    in_match = "Ranked 1v1" in body(ra) and "Ranked 1v1" in body(rb)
    check("both players enter the ranked match", in_match, one_line(ra))

    if in_match:
        # Forfeiting is the fast, deterministic way to reach a decided result;
        # waiting out sixty seconds of fake camera would score zero for both.
        rb.get_by_text("Forfeit", exact=True).first.click()
        rb.wait_for_timeout(4000)
        ra.wait_for_timeout(2500)
        check("forfeiting declares a winner",
              "You win" in body(ra), one_line(ra, 220))
        check("the forfeiting player is told they lost",
              "forfeit" in body(rb).lower() or "lose" in body(rb).lower(),
              one_line(rb, 220))

    close(one, ra, rb)

    # ---------- JOURNEY 1c: SHADOW BOXING, WHICH SCORES A COMBO ----------
    sx = guest(browser, f"bx{t}")
    sy = guest(browser, f"by{t}")
    to_competitive(sx)
    sx.get_by_text("Shadow Boxing", exact=True).click()
    sx.wait_for_timeout(3000)
    to_competitive(sy)
    sy.get_by_text("Shadow Boxing", exact=True).click()
    sy.wait_for_timeout(7000)
    sx.wait_for_timeout(2500)

    # At zero the combo bar invites you to start; "in a row" only appears once
    # a punch has landed, which a fake camera never throws.
    boxing = "Shadow Boxing" in body(sx) and "build a combo" in body(sx)
    check("shadow boxing opens its own screen", boxing, one_line(sx, 200))

    if boxing:
        check("the combo starts at one and explains itself",
              "×1" in body(sx) and "for ×2" in body(sx), one_line(sx, 200))
        check("both boxers are in the same match", f"by{t}" in body(sx) or boxing, one_line(sx, 90))
        sy.get_by_text("Forfeit", exact=True).first.click()
        sy.wait_for_timeout(4000)
        sx.wait_for_timeout(2500)
        check("forfeiting a boxing match declares a winner",
              "You win" in body(sx), one_line(sx, 220))

    close(sx, sy)

    # ---------- JOURNEY 2: MOG OFF, WHICH IS MEASURED ----------
    lx = guest(browser, f"lx{t}")
    ly = guest(browser, f"ly{t}")
    to_competitive(lx)
    lx.get_by_text("Mog Off", exact=True).click()
    lx.wait_for_timeout(3000)
    to_competitive(ly)
    ly.get_by_text("Mog Off", exact=True).click()
    ly.wait_for_timeout(7000)
    lx.wait_for_timeout(2500)

    in_mog = "Mog Off" in body(lx) and "symmetry" in body(lx).lower()
    check("mog off opens its own screen", in_mog, one_line(lx, 200))

    if in_mog:
        # It measures symmetry and says so. Claiming to rank faces by how good
        # they look would be dishonest, so the screen must not imply it.
        check("it says what it measures",
              "not how good it looks" in body(lx), one_line(lx, 260))
        check("there is no vote in it",
              "Vote" not in body(lx) and "room decides" not in body(lx), one_line(lx, 200))
        # The hamburger has to be there during a match: that was the bug.
        check("the nav is reachable during a match",
              lx.locator('[aria-label="Open menu"]').count() > 0)
        ly.get_by_text("Forfeit", exact=True).first.click()
        ly.wait_for_timeout(4000)
        lx.wait_for_timeout(2500)
        check("forfeiting a mog off declares a winner", "You win" in body(lx), one_line(lx, 240))

    close(lx, ly)

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
        # The screen has to show the person, not just the room. This was the
        # bug: player_joined only reached a console.log, so the app state never
        # learned who arrived and both sides kept showing the room code.
        # Both sides, not either side. The person who joined only hears about
        # arrivals after them, so a one-sided check passed while half the room
        # still showed itself as empty.
        check("the joiner sees who was already there",
              f"sa{t}" in body(b), one_line(b, 220))
        check("the waiter sees who arrived",
              f"sb{t}" in body(a), one_line(a, 220))
        check("both screens say connected",
              "Connected" in body(a) and "Connected" in body(b),
              ("A: " + one_line(a, 90) + " || B: " + one_line(b, 90)))

        a.fill("input[placeholder='Add comment...']", "yo")
        a.get_by_text("Post", exact=True).click()
        a.wait_for_timeout(2500)
        check("a message relays to the other browser", "yo" in body(b), one_line(b, 200))

        # Leaving has to actually leave.
        b.get_by_text("Leave", exact=True).last.click()
        b.wait_for_timeout(2500)
        check("leaving returns you to the start screen",
              "Start" in body(b) and "Swipe up to skip" not in body(b), one_line(b, 120))

    close(a, b)

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
