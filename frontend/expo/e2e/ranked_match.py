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
    smoke_pg.get_by_text("Competitive", exact=True).last.click(); smoke_pg.wait_for_timeout(1500)

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
    check("player 1 queues", "Finding an opponent" in p1.inner_text("body"), p1.inner_text("body")[:110].replace("\n"," | "))

    to_competitive(p2)
    p2.get_by_text("Push-Ups", exact=True).click(); p2.wait_for_timeout(6000)
    b2=p2.inner_text("body")
    check("player 2 enters the ranked match", "Ranked 1v1" in b2, b2[:170].replace("\n"," | "))

    p1.wait_for_timeout(4000); b1=p1.inner_text("body")
    check("player 1 pulled in by match_start", "Ranked 1v1" in b1, b1[:170].replace("\n"," | "))
    check("the rep counter is present", "YOU" in b1 and "OPPONENT" in b1)
    p1.screenshot(path="/tmp/ranked.png", full_page=True)

    print("\n=== errors p1 ==="); [print("  ",x[:150]) for x in e1[:5]]
    print("=== errors p2 ==="); [print("  ",x[:150]) for x in e2[:5]]
    b.close()
print("\n"+"="*50)
bad=[n for n,ok,_ in res if not ok]
print(f"{len(res)-len(bad)}/{len(res)} passed")
if bad: print("FAILED:",bad)
