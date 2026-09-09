#!/usr/bin/env python3
"""Trap Chat -- the account settings, driven for real.

There was no way to change a password in the app at all, and signing out only
forgot the token on the device doing it. This drives what replaced that, with
real accounts and real sign-ins, because the claims are all about what happens
to a *different* session and none of them can be checked from one browser.

    python e2e/account_security.py                 # against a local build
    python e2e/account_security.py https://<host>/

Requires: pip install playwright && playwright install chromium
"""

from playwright.sync_api import sync_playwright
import sys
import time

APP = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100/"
FIRST = "Str0ng-Pass!1"
SECOND = "An0ther-Pass!2"
res = []


def check(name, ok, detail=""):
    res.append((name, ok, detail))
    line = f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  |  {detail[:150]}" if detail else "")
    # Emoji in the app, cp1252 in the console. Printing raw ended the run.
    print(line.encode("ascii", "replace").decode("ascii"), flush=True)


def body(page):
    return page.inner_text("body")


def one_line(page, n=150):
    return body(page)[:n].replace("\n", " | ")


def open_app(browser):
    page = browser.new_context(
        viewport={"width": 430, "height": 900}, is_mobile=True, has_touch=True,
        permissions=["camera", "microphone"],
    ).new_page()
    page.goto(APP, wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(2500)
    return page


def register(browser, username, password=FIRST):
    page = open_app(browser)
    page.get_by_label("Username", exact=True).fill(username)
    page.get_by_label("Password", exact=True).fill(password)
    page.get_by_text("Create account", exact=True).click()
    page.wait_for_timeout(4500)
    return page


def sign_in(browser, username, password):
    page = open_app(browser)
    page.get_by_text("Already have an account? Sign in", exact=True).click()
    page.wait_for_timeout(600)
    page.get_by_label("Username", exact=True).fill(username)
    page.get_by_label("Password", exact=True).fill(password)
    page.get_by_text("Sign in", exact=True).click()
    page.wait_for_timeout(4500)
    return page


def to_profile(page):
    menu = page.locator('[aria-label="Open menu"]')
    if menu.count() > 0:
        menu.first.click()
        page.wait_for_timeout(600)
    page.locator('[aria-label="Profile"]').last.click()
    page.wait_for_timeout(1600)


# The auth screen has two modes and only this line is on both of them.
# "Create account" is the register button, so it is absent when a rejected
# sign-in leaves you on the sign-in side -- which reads as "still signed in".
AUTH_SCREEN = "Continue as guest"


def signed_out(page):
    return AUTH_SCREEN in body(page)


def signed_in(page):
    """Reloading is the honest check: it makes the app ask the server again."""
    page.reload(wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(3500)
    return not signed_out(page)


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-fake-ui-for-media-stream",
                                      "--use-fake-device-for-media-stream"])
    t = int(time.time())
    who = f"sec{t}"

    page = register(browser, who)
    to_profile(page)
    # Every label lookup here is exact: get_by_label matches substrings, so
    # "New password" also finds the "Save new password" button and the whole
    # thing fails as an ambiguity thirty seconds later.
    check("an account has a security section", "SECURITY" in body(page), one_line(page, 220))
    check("changing a password is offered",
          page.get_by_label("Change password", exact=True).count() > 0, one_line(page, 220))
    check("deleting the account is offered",
          page.get_by_label("Delete account", exact=True).count() > 0, one_line(page, 220))

    # A second device, holding a session from before anything changes.
    other = sign_in(browser, who, FIRST)
    check("the same account signs in on a second device", signed_in(other), one_line(other, 120))

    # The wrong current password must not change anything.
    page.get_by_label("Change password", exact=True).first.click()
    page.wait_for_timeout(800)
    page.get_by_label("Current password", exact=True).fill("not-my-password")
    page.get_by_label("New password", exact=True).fill(SECOND)
    page.get_by_label("Save new password", exact=True).first.click()
    page.wait_for_timeout(3000)
    check("a wrong current password is refused",
          "wrong" in body(page).lower(), one_line(page, 220))

    # And a weak new one, by the same rules registration uses.
    page.get_by_label("Current password", exact=True).fill(FIRST)
    page.get_by_label("New password", exact=True).fill("password")
    page.get_by_label("Save new password", exact=True).first.click()
    page.wait_for_timeout(3000)
    check("a common password is refused when changing too",
          "common" in body(page).lower(), one_line(page, 220))

    # Now the real thing.
    page.get_by_label("Current password", exact=True).fill(FIRST)
    page.get_by_label("New password", exact=True).fill(SECOND)
    page.get_by_label("Save new password", exact=True).first.click()
    page.wait_for_timeout(4000)
    check("the password changes", "Password changed" in body(page), one_line(page, 220))

    # The session that did it stays usable. Without a fresh token in the
    # response this signs you out of your own account.
    check("you are still signed in where you changed it", signed_in(page), one_line(page, 120))

    # The other device is done, which is the entire point.
    check("the other device is signed out", not signed_in(other), one_line(other, 120))
    try:
        other.context.close()
    except Exception:
        pass

    # The old password is genuinely gone.
    stale = sign_in(browser, who, FIRST)
    check("the old password no longer works", signed_out(stale), one_line(stale, 150))
    try:
        stale.context.close()
    except Exception:
        pass

    fresh = sign_in(browser, who, SECOND)
    check("the new password works", signed_in(fresh), one_line(fresh, 120))
    try:
        fresh.context.close()
    except Exception:
        pass

    # Deleting needs the password, and then really deletes.
    to_profile(page)
    page.get_by_label("Delete account", exact=True).first.click()
    page.wait_for_timeout(800)
    check("deleting warns that it cannot be undone",
          "cannot be undone" in body(page), one_line(page, 220))

    page.get_by_label("Password to delete account", exact=True).fill("not-my-password")
    page.get_by_label("Delete my account", exact=True).first.click()
    page.wait_for_timeout(3000)
    check("deleting with the wrong password is refused",
          "wrong" in body(page).lower(), one_line(page, 220))

    page.get_by_label("Password to delete account", exact=True).fill(SECOND)
    page.get_by_label("Delete my account", exact=True).first.click()
    page.wait_for_timeout(4500)
    check("deleting signs you out", signed_out(page), one_line(page, 150))

    gone = sign_in(browser, who, SECOND)
    check("the deleted account cannot sign in again", signed_out(gone), one_line(gone, 150))

    # A guest has no password, so none of this is shown to them.
    guest = open_app(browser)
    guest.fill("input[placeholder='Pick a name (optional)']", f"gst{t}")
    guest.get_by_text("Continue as guest", exact=True).click()
    guest.wait_for_timeout(4500)
    to_profile(guest)
    check("a guest is not offered password settings",
          "SECURITY" not in body(guest), one_line(guest, 220))

    browser.close()

print("\n" + "=" * 60)
bad = [n for n, ok, _ in res if not ok]
print(f"{len(res) - len(bad)}/{len(res)} passed")
if bad:
    print("FAILED:")
    for name in bad:
        print(f"  - {name}")
raise SystemExit(1 if bad else 0)
