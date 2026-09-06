#!/usr/bin/env python3
"""Trap Chat — ranked matchmaking test.

Two independent browsers queue for the same game and must both end up in the
match with the rep counter running. This is the flow that broke twice: once
because a full match was handed back still waiting, and once because a dropped
socket pulled a player out of their own queue.

    python e2e/ranked_match.py                 # against a local build
    python e2e/ranked_match.py https://<host>/

Requires: pip install playwright && playwright install chromium
"""

from playwright.sync_api import sync_playwright
import sys, time, re
res=[]
def check(n,ok,d=""): res.append((n,ok,d)); print(f"{'PASS' if ok else 'FAIL'}  {n}"+(f"  |  {d[:150]}" if d else ""), flush=True)
APP = sys.argv[1] if len(sys.argv)>1 else "http://127.0.0.1:8100/"

def guest(pg, name):
    pg.goto(APP, wait_until="networkidle", timeout=90000); pg.wait_for_timeout(2500)
    pg.fill("input[placeholder='Pick a name (optional)']", name)
    pg.get_by_text("Continue as guest", exact=True).click(); pg.wait_for_timeout(4500)

def to_competitive(smoke_pg):
    smoke_pg.locator('[aria-label="Open menu"]').first.click(); smoke_pg.wait_for_timeout(800)
    smoke_pg.locator('[aria-label="Competitive"]').last.click(); smoke_pg.wait_for_timeout(1500)

with sync_playwright() as p:
    b=p.chromium.launch(args=["--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream"])
    ctxs=[b.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True,
                        permissions=["camera","microphone"]) for _ in range(2)]
    p1,p2=[c.new_page() for c in ctxs]
    e1,e2=[],[]
    p1.on("console", lambda m: e1.append(m.text) if m.type=="error" else None)
    p2.on("console", lambda m: e2.append(m.text) if m.type=="error" else None)
    t=int(time.time())
    guest(p1,f"ra{t}"); guest(p2,f"rb{t}")

    to_competitive(p1)
    p1.get_by_text("Push-Ups", exact=True).click(); p1.wait_for_timeout(3000)
    check("player 1 queues", "queue" in p1.inner_text("body").lower(), p1.inner_text("body")[:140].replace(chr(10), " | "))

    to_competitive(p2)
    p2.get_by_text("Push-Ups", exact=True).click(); p2.wait_for_timeout(6000)
    b2=p2.inner_text("body")
    check("player 2 enters the ranked match", "Ranked 1v1" in b2, b2[:170].replace("\n"," | "))

    p1.wait_for_timeout(4000); b1=p1.inner_text("body")
    check("player 1 pulled in by match_start", "Ranked 1v1" in b1, b1[:170].replace("\n"," | "))
    check("the rep counter is present", "YOU" in b1 and "OPPONENT" in b1)
    p1.screenshot(path="/tmp/ranked.png", full_page=True)

    # A queue nobody else is in looks exactly like a broken one, and so does a
    # queue whose opponent picked a different game. The banner has to state
    # which queue you are in and who is actually in it, from the server.
    def fresh_guest(name):
        page = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                             has_touch=True, permissions=["camera", "microphone"]).new_page()
        guest(page, name)
        to_competitive(page)
        return page

    solo = fresh_guest(f"rc{t}")
    solo.get_by_text("Rap Battle", exact=True).click(); solo.wait_for_timeout(6000)
    early = solo.inner_text("body")
    if "Ranked 1v1" in early:
        print("SKIP  the lone-queue checks: someone else was queued for Rap Battle", flush=True)
    else:
        check("a lone queue names the game it is for", "Rap Battle" in early,
              early[:110].replace(chr(10), " | "))
        check("a lone queue says you are the only one",
              "only one in this queue" in early, early[:130].replace(chr(10), " | "))

        # The bug this was all reported as: two people queue, for different
        # games, and both wait forever while each looks broken.
        other = fresh_guest(f"rd{t}")
        other.get_by_text("Looks Battle", exact=True).click(); other.wait_for_timeout(6000)
        other_body = other.inner_text("body")
        if "Ranked 1v1" in other_body:
            print("SKIP  different-queue check: someone was queued for Looks Battle", flush=True)
        else:
            check("a different game is a different queue",
                  "only one in this queue" in other_body,
                  other_body[:130].replace(chr(10), " | "))

        # ...and picking the same one pairs them.
        joiner = fresh_guest(f"re{t}")
        joiner.get_by_text("Rap Battle", exact=True).click(); joiner.wait_for_timeout(7000)
        solo.wait_for_timeout(3000)
        # A paired Rap Battle opens its own beat picker, not the generic
        # ranked match screen.
        check("queueing for the same game pairs both sides",
              "Pick a beat" in joiner.inner_text("body") and "Pick a beat" in solo.inner_text("body"),
              joiner.inner_text("body")[:110].replace(chr(10), " | "))



    # Two clients that have each queued before. This is the shape the bug had:
    # both had a queue of their own from an earlier attempt, so neither ever
    # looked for the other and both were told they were the only one waiting.
    def queue_then_requeue(page, game):
        """Queue, cancel, queue again. Returns False if a real opponent was
        already waiting, in which case there is no lonely queue to test."""
        page.get_by_text(game, exact=True).click(); page.wait_for_timeout(4000)
        if page.get_by_text("Cancel", exact=True).count() == 0:
            return False
        page.get_by_text("Cancel", exact=True).click(); page.wait_for_timeout(1500)
        page.get_by_text(game, exact=True).click(); page.wait_for_timeout(4000)
        return True

    a = fresh_guest(f"qa{t}")
    bb = fresh_guest(f"qb{t}")
    if not queue_then_requeue(a, "Squats"):
        print("SKIP  re-queue check: somebody was already queued for Squats", flush=True)
    else:
        queue_then_requeue(bb, "Squats")
        bb.wait_for_timeout(5000); a.wait_for_timeout(3000)
        check("two clients that both re-queued still pair",
              "Ranked 1v1" in a.inner_text("body") and "Ranked 1v1" in bb.inner_text("body"),
              ("A: " + a.inner_text("body")[:60] + " || B: " + bb.inner_text("body")[:60]).replace(chr(10), " | "))

    print("=== errors p1 ==="); [print("  ",x[:150]) for x in e1[:5]]
    print("=== errors p2 ==="); [print("  ",x[:150]) for x in e2[:5]]
    b.close()
print("\n"+"="*50)
bad=[n for n,ok,_ in res if not ok]
print(f"{len(res)-len(bad)}/{len(res)} passed")
if bad: print("FAILED:",bad)
