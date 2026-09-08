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

# Nav labels match the page names now that both layouts use one list.
NAV_LABELS: dict[str, str] = {}

# What proves a page actually rendered. Matching on visible copy rather than
# test ids keeps these honest: if the page is blank the assertion fails.
PAGE_MARKERS = {
    "Random": ["Swipe up to skip", "Drop into a channel", "Searching"],
    "Browse": ["JOIN BY CODE", "START A ROOM"],
    "Competitive": ["Ranked matchmaking"],
    # The tabs are always there whether or not anybody has scored, which the
    # old markers were not: one named a game that is no longer offered and the
    # other only appears while the board is empty.
    "Leaderboards": ["Squats", "Mog Off"],
    "Profile": ["SIGNED IN AS", "SETTINGS"],
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
        line = f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  |  {detail[:150]}" if detail else "")
        # Emoji in the app, cp1252 in the console. Printing raw ended the
        # whole run with a UnicodeEncodeError that read like a real failure.
        print(line.encode("ascii", "replace").decode("ascii"), flush=True)
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
        # The phone keeps the nav behind the hamburger; the sidebar is always
        # on screen and has no hamburger to open. aria-label is what separates
        # a nav row from the page title, which can carry the same words.
        if self.page.locator('[aria-label="Open menu"]').count():
            self.open_nav()
        self.page.locator(f'[aria-label="{NAV_LABELS.get(name, name)}"]').last.click()
        self.page.wait_for_timeout(1400)

    def sign_in_as_guest(self, display_name: str = "smoke", attempts: int = 5) -> None:
        # A container that scaled to zero, or one mid-rollout, can take a few
        # seconds to answer. Retry rather than failing the deployment over a
        # cold start.
        for attempt in range(1, attempts + 1):
            self.page.goto(TARGET, wait_until="networkidle", timeout=90000)
            self.page.wait_for_timeout(2500)
            try:
                self.page.fill("input[placeholder='Pick a name (optional)']", display_name)
                self.page.get_by_text("Continue as guest", exact=True).click()
            except Exception:
                pass
            self.page.wait_for_timeout(5000)
            if "Create an account to save scores" not in self.body():
                return
            print(f"  (guest sign-in attempt {attempt} did not take, retrying)", flush=True)
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
    # A listed room has to say which kind it is before you commit to joining.
    browse = smoke.body()
    smoke.check("Browse offers video and text rooms",
                "Video room" in browse and "Text room" in browse,
                browse[:160].replace(chr(10), " | "))
    smoke.check("listed rooms are labelled video or text",
                "VIDEO" in browse or "TEXT" in browse, browse[:220].replace(chr(10), " | "))

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
    smoke.check("competitive lists ranked games",
                all(name in text for name in ("Push-Ups", "Squats", "Shadow Boxing", "Mog Off")), text[:120])
    # Rap Battle is built but held back until it has a turn structure, so it
    # must not be on the board.
    smoke.check("competitive does not offer a held-back game", "Rap Battle" not in text)

    # --- CONSOLE ------------------------------------------------------
    smoke.check("no console errors", not smoke.console_errors, "; ".join(smoke.console_errors[:2]))


def run_small_phone(smoke: Smoke) -> None:
    """A 360x640 Android, smaller than the 390x844 the main pass uses.

    Most people are on a phone, and a phone's failures are layout failures: a
    page wider than the screen, a control pushed off the bottom, a tap target
    too small to hit. None of those raise an exception, so they get measured.
    """
    page = smoke.page
    page.goto(TARGET, wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(2500)
    smoke.sign_in_as_guest("tiny")

    for name in PAGES:
        smoke.goto(name)
        text = smoke.body()
        smoke.check(f"phone: {name} renders",
                    any(marker in text for marker in PAGE_MARKERS[name]),
                    text[:110].replace(chr(10), " | "))
        # Nothing may be wider than the screen. A sideways scrollbar on a phone
        # means something is cut off and unreachable.
        overflow = page.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        smoke.check(f"phone: {name} does not scroll sideways", overflow <= 1,
                    f"{overflow}px wider than the screen")

    # The hamburger is how you get anywhere on a phone, so it has to be there
    # and be big enough to hit.
    box = page.locator('[aria-label="Open menu"]').first.bounding_box()
    smoke.check("phone: the menu button exists", box is not None)
    if box:
        smoke.check("phone: the menu button is big enough to tap",
                    box["width"] >= 28 and box["height"] >= 20,
                    f"{round(box['width'])}x{round(box['height'])}")

    smoke.check("phone: no console errors", not smoke.console_errors,
                "; ".join(smoke.console_errors[:2]))



def run_cold_backend(smoke: Smoke) -> None:
    """A first visit while the container is asleep.

    min_replicas is 0 to keep the pilot free, so the first request after an
    idle spell waits for a container to start: measured at over thirty
    seconds. The app used to spend all of that on a splash screen before
    anyone could type a name, which is the entire first impression gone on a
    question the browser could already answer -- nothing stored means nobody
    to restore. This holds the backend at arm's length and checks the screen
    arrives anyway.
    """
    page = smoke.page
    # Never resolve the request. A handler that sleeps blocks Playwright's
    # route thread and dies with the context; simply not answering is what a
    # container that has not woken up yet actually looks like.
    page.route("**/api/auth/me", lambda route: None)
    started = time.time()
    page.goto(TARGET, wait_until="domcontentloaded", timeout=90000)
    try:
        page.wait_for_selector("input[placeholder='Pick a name (optional)']", timeout=15000)
        elapsed = time.time() - started
        smoke.check("a cold backend does not hold up the first screen",
                    elapsed < 12, f"{elapsed:.1f}s to a usable screen")
    except Exception:
        smoke.check("a cold backend does not hold up the first screen", False,
                    "never became usable while the backend was slow")
    page.unroute_all(behavior="ignoreErrors")



def run_desktop(smoke: Smoke) -> None:
    """The web layout is a separate tree, not a reflow of the phone one: a
    persistent sidebar instead of a tab bar and a drawer. Nothing the mobile
    pass proves carries over, so it gets walked too."""
    page = smoke.page
    page.goto(TARGET, wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(2500)
    smoke.sign_in_as_guest("web")

    body = smoke.body()
    smoke.check("web: sidebar shows every nav entry",
                all(name in body for name in PAGES),
                body[:120].replace("\n", " | "))
    smoke.check("web: no hamburger on the sidebar layout",
                page.locator('[aria-label="Open menu"]').count() == 0)
    smoke.check("web: Social opens into Random and Browse",
                "Random" in body and "Browse" in body and "Social" in body)

    for name in PAGES:
        smoke.goto(name)
        text = smoke.body()
        smoke.check(f"web: {name} renders",
                    any(marker in text for marker in PAGE_MARKERS[name]),
                    text[:110].replace("\n", " | "))

    smoke.check("web: no console errors", not smoke.console_errors,
                "; ".join(smoke.console_errors[:2]))


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

            print("--- cold backend ---", flush=True)
            cold = browser.new_context(viewport={"width": 390, "height": 844},
                                       is_mobile=True, has_touch=True)
            cold_smoke = Smoke(cold.new_page())
            cold_smoke.results = smoke.results
            run_cold_backend(cold_smoke)
            cold.close()

            print("--- small phone ---", flush=True)
            small = browser.new_context(
                viewport={"width": 360, "height": 640}, is_mobile=True, has_touch=True,
                permissions=["camera", "microphone"],
            )
            phone_smoke = Smoke(small.new_page())
            phone_smoke.results = smoke.results
            run_small_phone(phone_smoke)
            small.close()


            print("\n--- desktop layout ---", flush=True)
            wide = browser.new_context(
                viewport={"width": 1440, "height": 900},
                permissions=["camera", "microphone"],
            )
            desktop_smoke = Smoke(wide.new_page())
            desktop_smoke.results = smoke.results
            run_desktop(desktop_smoke)
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
