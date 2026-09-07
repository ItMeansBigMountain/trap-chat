#!/usr/bin/env python3
"""Trap Chat — punch counting unit tests.

Runs the real punch rules in a real browser, driven with synthetic arm
positions. No camera and no pose model, so this is fast enough for every
build while still testing the shipped code.

A punch is not a rep: the two arms are independent, speed is what separates a
punch from reaching for something, and the score is punches times a combo
multiplier rather than the count. Each of those is a way to get it wrong, so
each has a case here.

    python e2e/punch_counter.py                 # against a local build
    python e2e/punch_counter.py https://<host>/

Requires: pip install playwright && playwright install chromium
"""

import sys

from playwright.sync_api import sync_playwright

DEFAULT_TARGET = "http://127.0.0.1:8100/"

DRIVER = """
() => {
  const mod = globalThis.__trapChatPunchCounter;
  if (!mod) return { error: 'punch counter not exposed on this build' };

  // Elbow at the origin with the shoulder above it, wrist swung round to make
  // the asked-for elbow angle. Each arm is posed independently.
  function pose(leftDeg, rightDeg) {
    const l = [];
    for (let i = 0; i < 33; i++) l.push({ x: 0, y: 0, visibility: 1 });
    const arm = (deg, shoulder, elbow, wrist) => {
      const r = (deg * Math.PI) / 180;
      l[elbow] = { x: 0, y: 0, visibility: 1 };
      l[shoulder] = { x: 0, y: -1, visibility: 1 };
      l[wrist] = { x: Math.sin(r), y: -Math.cos(r), visibility: 1 };
    };
    arm(leftDeg, 11, 13, 15);
    arm(rightDeg, 12, 14, 16);
    return l;
  }

  const GUARD = 70;      // cocked
  const OUT = 170;       // extended

  // Throw `n` punches, alternating hands, `gap` ms apart. Each throw is two
  // frames: extend, then pull back.
  function throwPunches(counter, n, gap, startAt) {
    let clock = startAt || 0;
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0;
      clock += gap;
      counter.update(left ? pose(OUT, GUARD) : pose(GUARD, OUT), clock);
      clock += 40;
      counter.update(pose(GUARD, GUARD), clock);
    }
    return clock;
  }

  const out = {};

  // Ten alternating punches: ten thrown, and the tenth is the one that earns
  // the new rate, so nine at one point plus one at two.
  let c = new mod.PunchCounter();
  throwPunches(c, 10, 200);
  out.ten = { punches: c.total, score: c.points, multiplier: c.multiplier };

  // Twenty-five, so the multiplier has stepped twice.
  c = new mod.PunchCounter();
  throwPunches(c, 25, 200);
  out.twentyFive = { punches: c.total, score: c.points, multiplier: c.multiplier };

  // Same punches, but with a rest in the middle long enough to break it.
  c = new mod.PunchCounter();
  let t = throwPunches(c, 12, 200);
  t += mod.COMBO_WINDOW_MS + 500;
  throwPunches(c, 3, 200, t);
  out.broken = { punches: c.total, multiplier: c.multiplier, combo: c.multiplier };

  // Holding an arm out is one punch, not one per frame.
  c = new mod.PunchCounter();
  for (let i = 0; i < 40; i++) c.update(pose(OUT, GUARD), 1000 + i * 40);
  out.held = c.total;

  // Straightening slowly is reaching, not punching.
  c = new mod.PunchCounter();
  let slow = 0;
  for (const deg of [70, 90, 110, 130, 150, 170]) {
    slow += 400;                       // 2s to extend
    c.update(pose(deg, GUARD), slow);
  }
  out.slow = c.total;

  // Both arms at once still counts as two punches, not one.
  c = new mod.PunchCounter();
  c.update(pose(OUT, OUT), 1000);
  out.bothArms = c.total;

  // Arms out of frame count nothing, and say so.
  const hidden = [];
  for (let i = 0; i < 33; i++) hidden.push({ x: 0, y: 0, visibility: 0 });
  c = new mod.PunchCounter();
  const blind = c.update(hidden, 1000);
  out.hidden = { punches: c.total, hint: Boolean(blind.hint) };

  // The multiplier table itself.
  out.multipliers = [0, 5, 10, 19, 20, 40, 100].map(mod.multiplierFor);
  out.cap = mod.MAX_MULTIPLIER;
  return out;
}
"""


def main() -> int:
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TARGET
    print(f"punch counter target: {target}\n")
    results: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        results.append((name, ok, detail))
        print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  |  {detail}" if detail else ""), flush=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(target, wait_until="networkidle", timeout=90000)
        page.wait_for_timeout(2500)
        out = page.evaluate(DRIVER)
        browser.close()

    if isinstance(out, dict) and out.get("error"):
        print(f"FAIL  {out['error']}")
        return 1

    ten = out["ten"]
    check("ten alternating punches all count", ten["punches"] == 10, str(ten))
    # Punches 1-9 pay one each; the tenth is where the multiplier becomes two.
    check("the tenth punch earns the new rate", ten["score"] == 9 + 2, str(ten))
    check("ten in a row is a two times multiplier", ten["multiplier"] == 2, str(ten))

    quarter = out["twentyFive"]
    check("twenty five punches all count", quarter["punches"] == 25, str(quarter))
    check("the multiplier steps twice by twenty five", quarter["multiplier"] == 3, str(quarter))
    # 9 at x1, 10 at x2 (punches 10-19), 6 at x3 (punches 20-25).
    check("the score follows the multiplier", quarter["score"] == 9 + 20 + 18, str(quarter))

    broken = out["broken"]
    check("resting breaks the combo", broken["multiplier"] == 1, str(broken))
    check("a broken combo keeps the punches", broken["punches"] == 15, str(broken))

    check("holding an arm out is one punch", out["held"] == 1, f"got {out['held']}")
    check("reaching slowly is not a punch", out["slow"] == 0, f"got {out['slow']}")
    check("both arms at once is two punches", out["bothArms"] == 2, f"got {out['bothArms']}")
    check("arms out of frame count nothing", out["hidden"]["punches"] == 0)
    check("arms out of frame say why", out["hidden"]["hint"] is True)

    check("the multiplier table steps every ten",
          out["multipliers"] == [1, 1, 2, 2, 3, 5, 5], str(out["multipliers"]))
    check("the multiplier is capped", out["cap"] == 5, str(out["cap"]))

    failed = [name for name, ok, _ in results if not ok]
    print("\n" + "=" * 60)
    print(f"{len(results) - len(failed)}/{len(results)} passed")
    if failed:
        print("FAILED:")
        for name in failed:
            print(f"  - {name}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
