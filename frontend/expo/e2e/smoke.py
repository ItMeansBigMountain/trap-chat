#!/usr/bin/env python3
"""Trap Chat — frontend smoke tests.

Drives the real UI in a real browser and walks every navigation path the app
has. The app is small enough that the whole interaction space is worth
covering exhaustively, which catches the class of bug that does not fail a
build: a page that never renders, one screen stacked on another, a control
that disappears, a route that hijacks another.

    python e2e/smoke.py                      # against a local build
    python e2e/smoke.py https://<host>/      # against a deployment

Requires: pip install playwright && playwright install chromium
"""

import sys
import time

from playwright.sync_api import sync_playwright, Page

DEFAULT_TARGET = "http://127.0.0.1:8100/"
PAGES = ["Random", "Browse", "Competitive", "Leaderboards", "Profile"]

# The side nav label is not always the page name.
NAV_LABELS = {"Profile": "Profile & settings"}

# What proves a page actually rendered. Matching on visible copy rather than
# test ids keeps these honest: if the page is blank the assertion fails.
PAGE_MARKERS = {
    "Random": ["Swipe up to skip", "Drop into a channel", "Searching"],
    "Browse": ["JOIN BY CODE", "START A ROOM"],
    "Competitive": ["Ranked matchmaking"],
    "Leaderboards": ["No scores yet", "Rap Battle"],
    "Profile": ["SIGNED IN AS", "MATCH ME WITH"],
}

# A page must not leave its content behind when you navigate away.
EXCLUSIVE_MARKERS = {
    "Browse": "JOIN BY CODE",
    "Competitive": "Ranked matchmaking",
    "Profile": "SIGNED IN AS",
}


class Smoke:
    def __init__(self, page: Page):
        self.page = page
        self.results: list[tuple[str, bool, str]] = []
        self.console_errors: list[str] = []
        page.on(
            "console",
            lambda m: self.console_errors.append(m.text) if m.type == "error" else None,
        )

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        self.results.append((name, ok, detail))
        print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  |  {detail[:150]}" if detail else ""), flush=True)
        return ok

    def body(self) -> str:
        return self.page.inner_text("body")

    def nav_is_open(self) -> bool:
        # The drawer stays mounted when closed so it can animate, so its text
        # is always present. The backdrop only exists while it is open.
        return self.page.locator('[aria-label="Close menu"]').count() > 0

    def open_nav(self) -> None:
        if self.nav_is_open():
            return
        self.page.locator('[aria-label="Open menu"]').first.click()
        self.page.wait_for_timeout(700)

    def close_nav(self) -> None:
        if not self.nav_is_open():
            return
        # The backdrop spans the whole screen with the drawer drawn on top of
        # it, so aim at the strip to the right of the drawer.
        self.page.locator('[aria-label="Close menu"]').first.click(
            position={"x": 372, "y": 500}
        )
        self.page.wait_for_timeout(500)

    def goto(self, name: str) -> None:
        # The header title and the nav link share a label, so aim at the last
        # match: the drawer renders after the header.
        self.open_nav()
        self.page.get_by_text(NAV_LABELS.get(name, name), exact=True).last.click()
        self.page.wait_for_timeout(1400)

    def sign_in_as_guest(self, display_name: str = "smoke") -> None:
        self.page.goto(TARGET, wait_until="networkidle", timeout=90000)
        self.page.wait_for_timeout(2500)
        self.page.fill("input[placeholder='Pick a name (optional)']", display_name)
        self.page.get_by_text("Continue as guest", exact=True).click()
        self.page.wait_for_timeout(4000)


def run_for(smoke: Smoke) -> None:
    page = smoke.page

    # --- AUTH ---------------------------------------------------------
    page.goto(TARGET, wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(2500)
    smoke.check("auth screen offers a guest name", "Continue as guest" in smoke.body())
    smoke.sign_in_as_guest("smoke")
    body = smoke.body()
    smoke.check("guest reaches the app", "Trap Chat" not in body or "Random" in body, body[:100].replace("\n", " | "))
    smoke.check("guest name carries a discriminator", "smoke#" in body, [l for l in body.split("\n") if "smoke#" in l][:1])

    # --- EVERY PAGE RENDERS -------------------------------------------
    for name in PAGES:
        smoke.goto(name)
        text = smoke.body()
        hit = any(marker in text for marker in PAGE_MARKERS[name])
        smoke.check(f"{name} renders", hit, text[:120].replace("\n", " | "))

    # --- NO PAGE LEAKS INTO ANOTHER -----------------------------------
    # This is the stacked-screen bug: one page's content still visible on top
    # of the next one.
    for name, marker in EXCLUSIVE_MARKERS.items():
        for other in PAGES:
            if other == name:
                continue
            smoke.goto(other)
            leaked = marker in smoke.body()
            if not smoke.check(f"{name} content gone on {other}", not leaked, marker):
                break

    # --- EVERY ORDERED PAIR OF PAGES ----------------------------------
    # The app is small, so walk every transition rather than a happy path.
    failures = []
    for source in PAGES:
        for destination in PAGES:
            if source == destination:
                continue
            smoke.goto(source)
            smoke.goto(destination)
            text = smoke.body()
            if not any(marker in text for marker in PAGE_MARKERS[destination]):
                failures.append(f"{source}->{destination}")
    smoke.check(
        f"all {len(PAGES) * (len(PAGES) - 1)} page transitions land correctly",
        not failures,
        f"broken: {failures}" if failures else "",
    )

    # --- IN A ROOM, NAVIGATION STILL WORKS ----------------------------
    smoke.goto("Browse")
    page.fill("input[placeholder='Name it whatever you want']", "smoke room")
    page.get_by_text("Create and join", exact=True).click()
    page.wait_for_timeout(4500)
    smoke.check("creating a room enters it", "Swipe up to skip" in smoke.body(), smoke.body()[:120].replace("\n", " | "))

    smoke.open_nav()
    nav = smoke.body()
    smoke.check("side panel shows the room", "IN THIS ROOM" in nav)
    smoke.check("side panel offers Leave room", "Leave room" in nav)
    smoke.close_nav()

    # Browse must remain reachable while in a room, not redirect back to it.
    smoke.goto("Browse")
    smoke.check("Browse reachable while in a room", "JOIN BY CODE" in smoke.body(), smoke.body()[:120].replace("\n", " | "))

    for name in ["Competitive", "Leaderboards", "Profile"]:
        smoke.goto(name)
        text = smoke.body()
        smoke.check(f"{name} reachable while in a room", any(m in text for m in PAGE_MARKERS[name]))

    # --- LEAVING ------------------------------------------------------
    smoke.open_nav()
    page.get_by_text("Leave room", exact=True).last.click()
    page.wait_for_timeout(2500)
    smoke.open_nav()
    smoke.check("leaving clears the room", "NOT IN A ROOM" in smoke.body())
    smoke.close_nav()

    # --- COMPETITIVE RULES --------------------------------------------
    smoke.goto("Competitive")
    text = smoke.body()
    smoke.check("competitive offers no room code", "JOIN BY CODE" not in text)
    smoke.check("competitive lists ranked games", "Rap Battle" in text and "Looks Battle" in text)

    # --- CONSOLE ------------------------------------------------------
    smoke.check("no console errors", not smoke.console_errors, "; ".join(smoke.console_errors[:2]))


def main() -> int:
    global TARGET
    TARGET = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TARGET
    print(f"smoke target: {TARGET}\n")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
            ]
        )
        context = browser.new_context(
            viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
            permissions=["camera", "microphone"],
        )
        smoke = Smoke(context.new_page())
        try:
            run_for(smoke)
        finally:
            browser.close()

    failed = [name for name, ok, _ in smoke.results if not ok]
    print("\n" + "=" * 60)
    print(f"{len(smoke.results) - len(failed)}/{len(smoke.results)} passed")
    if failed:
        print("FAILED:")
        for name in failed:
            print(f"  - {name}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
