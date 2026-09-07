#!/usr/bin/env python3
"""Trap Chat — ad frequency tests.

The frequency cap is the only thing standing between this app and the ad
pattern that costs 15-25% of first sessions, so it gets tested like the
counting rules do: real code, in a real browser, driven by a fake clock.

    python e2e/ad_policy.py                 # against a local build
    python e2e/ad_policy.py https://<host>/

Requires: pip install playwright && playwright install chromium
"""

import sys

from playwright.sync_api import sync_playwright

DEFAULT_TARGET = "http://127.0.0.1:8100/"

DRIVER = """
() => {
  const m = globalThis.__trapChatAdPolicy;
  if (!m) return { error: 'ad policy not exposed on this build' };

  const MIN = 60000;
  const out = {};

  // Play `n` matches instantly and ask whether an ad is due.
  const after = (state, matches) => {
    let s = state;
    for (let i = 0; i < matches; i++) s = m.recordMatch(s);
    return s;
  };

  // Nothing in the first minute, however many matches are played.
  let s = m.freshState(0);
  s = after(s, 20);
  out.firstMinute = m.adIsDue(s, 'guest', 30000, false);

  // A guest past the grace period with enough matches sees one.
  s = m.freshState(0);
  s = after(s, 3);
  out.guestDue = m.adIsDue(s, 'guest', 2 * MIN, false);

  // ...but not with only two.
  s = m.freshState(0);
  s = after(s, 2);
  out.guestTooFewMatches = m.adIsDue(s, 'guest', 2 * MIN, false);

  // Never during a live chat, however overdue.
  s = m.freshState(0);
  s = after(s, 50);
  out.duringMatch = m.adIsDue(s, 'guest', 60 * MIN, true);

  // Straight after an ad, with matches played, the gap still has to pass.
  s = m.recordAd(after(m.freshState(0), 3), 2 * MIN);
  s = after(s, 5);
  out.guestTooSoon = m.adIsDue(s, 'guest', 3 * MIN, false);      // 1 min later
  out.guestGapPassed = m.adIsDue(s, 'guest', 5.5 * MIN, false);  // 3.5 min later

  // An account holder waits longer and plays more matches for the same ad.
  s = m.recordAd(after(m.freshState(0), 6), 2 * MIN);
  s = after(s, 6);
  out.accountTooSoon = m.adIsDue(s, 'account', 6 * MIN, false);   // 4 min later
  out.accountGapPassed = m.adIsDue(s, 'account', 11 * MIN, false); // 9 min later

  // An account holder with the gap but not the matches waits.
  s = m.recordAd(after(m.freshState(0), 6), 2 * MIN);
  s = after(s, 3);
  out.accountTooFewMatches = m.adIsDue(s, 'account', 20 * MIN, false);

  // The worst case the brief asked for: a guest skipping every 20 seconds
  // for ten minutes. Count how many ads that actually produces.
  s = m.freshState(0);
  let shown = 0;
  for (let t = 0; t <= 10 * MIN; t += 20000) {
    s = m.recordMatch(s);
    if (m.adIsDue(s, 'guest', t, false)) {
      s = m.recordAd(s, t);
      shown += 1;
    }
  }
  out.tenMinutesOfSkipping = shown;

  out.rules = m.RULES;
  out.skipAfter = m.SKIP_AFTER_MS;
  out.grace = m.GRACE_MS;
  return out;
}
"""


def main() -> int:
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TARGET
    print(f"ad policy target: {target}\n")
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

    check("no ads in the first minute", out["firstMinute"] is False)
    check("never during a live chat", out["duringMatch"] is False)

    check("a guest sees one after three matches", out["guestDue"] is True)
    check("a guest does not see one after two", out["guestTooFewMatches"] is False)
    check("a guest waits out the gap", out["guestTooSoon"] is False)
    check("a guest sees one once the gap passes", out["guestGapPassed"] is True)

    check("an account holder waits longer", out["accountTooSoon"] is False)
    check("an account holder sees one eventually", out["accountGapPassed"] is True)
    check("an account holder needs the matches too", out["accountTooFewMatches"] is False)

    # The number that matters. Ten minutes of relentless skipping is thirty
    # matches; Google's guidance is one interstitial an hour, and more than one
    # per two minutes is where measured retention damage starts.
    shown = out["tenMinutesOfSkipping"]
    check("relentless skipping is still capped", shown <= 4, f"{shown} ads in ten minutes")
    check("and is not so rare it earns nothing", shown >= 2, f"{shown} ads in ten minutes")

    check("an account holder is capped harder than a guest",
          out["rules"]["account"]["minGapMs"] > out["rules"]["guest"]["minGapMs"]
          and out["rules"]["account"]["minMatches"] > out["rules"]["guest"]["minMatches"],
          str(out["rules"]))
    check("every ad is skippable within five seconds", out["skipAfter"] <= 5000,
          str(out["skipAfter"]))
    check("the grace period is a full minute", out["grace"] >= 60000, str(out["grace"]))

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
