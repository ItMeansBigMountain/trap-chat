#!/usr/bin/env python3
"""Trap Chat -- everybody in the room is on the screen.

Video used to be a single connection: the remote face filled the frame and
your own camera sat in a corner, so a room of three showed you one stranger
and no sign that the third person existed. This drives the grid with real
browsers and real cameras, because the failure it replaces was invisible to
every test we had -- one connection is indistinguishable from three when you
only ever look at one.

What matters here is who is on screen, not whether the pixels arrived: a fake
camera in a headless browser produces a real MediaStream, which is enough to
prove the mesh negotiated with each peer separately.

    python e2e/video_grid.py                 # against a local build
    python e2e/video_grid.py https://<host>/

Requires: pip install playwright && playwright install chromium
"""

from playwright.sync_api import sync_playwright
import re
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


def one_line(page, n=140):
    return body(page)[:n].replace("\n", " | ")


def guest(browser, name, wide=False):
    context = browser.new_context(
        viewport={"width": 1280, "height": 900} if wide else {"width": 430, "height": 900},
        is_mobile=not wide,
        has_touch=not wide,
        permissions=["camera", "microphone"],
    )
    page = context.new_page()
    page.goto(APP, wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(2500)
    page.fill("input[placeholder='Pick a name (optional)']", name)
    page.get_by_text("Continue as guest", exact=True).click()
    page.wait_for_timeout(4500)
    return page


def close(*pages):
    for page in pages:
        try:
            page.context.close()
        except Exception:
            pass


def to_page(page, name):
    """Navigate, whichever nav this viewport has.

    Wide layouts show a sidebar and no hamburger, so opening a menu that is
    not there just times out thirty seconds later somewhere unrelated.
    """
    menu = page.locator('[aria-label="Open menu"]')
    if menu.count() > 0:
        menu.first.click()
        page.wait_for_timeout(600)
    page.locator(f'[aria-label="{name}"]').last.click()
    page.wait_for_timeout(1400)


def tiles(page):
    """How many people the grid is showing, whatever their camera is doing."""
    return page.locator('[aria-label$="tile"]').count()


def videos(page):
    return page.locator("video").count()


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

    # ---------- A ROOM OF TWO ----------
    a = guest(browser, f"ga{t}")
    b = guest(browser, f"gb{t}")
    a.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    for page in (a, b):
        to_page(page, "Random")
        page.get_by_text("Start", exact=True).first.click()
        page.wait_for_timeout(1500)
    a.wait_for_timeout(8000)
    b.wait_for_timeout(3000)

    paired = "Swipe up to skip" in body(a) or "2 here" in body(a)
    check("two strangers land in the same room", paired, one_line(a))

    if paired:
        # You are always a tile, and so is the other person. Before this the
        # local camera was a thumbnail in the corner and there was exactly one
        # remote frame, so "two tiles" was not a thing that could be true.
        check("both people have a tile", tiles(a) == 2, f"{tiles(a)} tiles")
        check("your own tile says it is you", "(you)" in body(a), one_line(a, 200))
        check("the other tile is named after them",
              f"gb{t}" in body(a), one_line(a, 200))
        check("both sides see two tiles", tiles(b) == 2, f"{tiles(b)} tiles on B")

        # A grid of two is two videos, not one video and a corner thumbnail.
        # Media arrives a moment after the tile does, so wait for it rather
        # than racing it.
        for _ in range(20):
            if videos(a) >= 2:
                break
            a.wait_for_timeout(1000)
        check("each tile carries its own video element",
              videos(a) == 2, f"{videos(a)} video elements")

    close(a, b)

    # ---------- A ROOM OF THREE ----------
    # The case the old single connection could not represent at all.
    host = guest(browser, f"gh{t}", wide=True)
    to_page(host, "Browse")

    made = False
    try:
        host.fill("input[placeholder='Name it whatever you want']", f"grid{t}")
        host.get_by_text("Group Chat", exact=True).first.click()
        host.wait_for_timeout(400)
        host.locator('[aria-label="Video room"]').first.click()
        host.wait_for_timeout(400)
        host.get_by_text("Create and join", exact=True).first.click()
        host.wait_for_timeout(6000)
        made = True
    except Exception as err:
        check("a group room can be made", False, str(err)[:140])

    if made:
        code = None
        match = re.search(r"\b([A-Z0-9]{8})\b", body(host))
        if match:
            code = match.group(1)
        check("the room has a code to share", code is not None, one_line(host, 200))

        joiners = []
        if code:
            for name in (f"gj1{t}", f"gj2{t}"):
                page = guest(browser, name, wide=True)
                to_page(page, "Browse")
                try:
                    page.fill("input[placeholder='e.g. 7F46927E']", code)
                    page.get_by_text("Join", exact=True).first.click()
                except Exception:
                    # Falling back to the listing is fine: the point of this
                    # journey is the grid, not how you got into the room.
                    try:
                        page.get_by_text(f"grid{t}", exact=False).first.click()
                    except Exception:
                        pass
                page.wait_for_timeout(7000)
                joiners.append(page)
            host.wait_for_timeout(8000)

            # Three people, three tiles, on every screen in the room.
            check("the host sees all three people", tiles(host) == 3, f"{tiles(host)} tiles")
            for index, page in enumerate(joiners):
                check(f"joiner {index + 1} sees all three people",
                      tiles(page) == 3, f"{tiles(page)} tiles")

            # And a departure takes its tile with it, rather than leaving a
            # frozen frame behind.
            if joiners:
                close(joiners[-1])
                host.wait_for_timeout(6000)
                check("a tile leaves when its person does",
                      tiles(host) == 2, f"{tiles(host)} tiles after one left")

        close(host, *[p for p in joiners[:-1]])

    print("\n=== console errors ===")
    for e in errors[:6]:
        print("  ", e.encode("ascii", "replace").decode("ascii")[:150])

    browser.close()

print("\n" + "=" * 60)
bad = [n for n, ok, _ in res if not ok]
print(f"{len(res) - len(bad)}/{len(res)} passed")
if bad:
    print("FAILED:")
    for name in bad:
        print(f"  - {name}")
raise SystemExit(1 if bad else 0)
