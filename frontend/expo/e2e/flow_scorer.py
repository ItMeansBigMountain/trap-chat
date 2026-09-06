#!/usr/bin/env python3
"""Trap Chat — flow scorer unit tests.

Drives the scoring rules in a real browser through the __trapChatFlowScorer
seam, feeding synthetic onset times rather than trying to rap into a headless
Chrome. What is being tested is the rule, not the microphone.

    python e2e/flow_scorer.py                 # against a local build
    python e2e/flow_scorer.py https://<host>/

Requires: pip install playwright && playwright install chromium
"""

from playwright.sync_api import sync_playwright
import sys

APP = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100/"
res = []


def check(name, ok, detail=""):
    res.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  |  {detail}" if detail else ""), flush=True)


# Every case: a list of onset times in seconds, and what must be true of the
# result. 120 BPM means a sixteenth every 0.125s.
SCRIPT = """
(() => {
  const { FlowScorer, gridErrorSeconds } = globalThis.__trapChatFlowScorer;
  const beat = { slug: 't', title: 'T', bpm: 120, offsetSec: 0 };
  const step = 60 / 120 / 4;          // 0.125s
  const out = {};

  // Dead on every sixteenth for the whole minute. At 120bpm a sixteenth is
  // 0.125s, so a full minute is 480 of them, not 240.
  let tight = new FlowScorer(beat, 60);
  for (let i = 0; i < 480; i++) tight.add(i * step);
  out.tight = tight.result();

  // The same number of syllables, each landing halfway between gridlines.
  let sloppy = new FlowScorer(beat, 60);
  for (let i = 0; i < 480; i++) sloppy.add(i * step + step / 2);
  out.sloppy = sloppy.result();

  // Tight, but only for the first six seconds of a sixty second turn.
  let short = new FlowScorer(beat, 60);
  for (let i = 0; i < 48; i++) short.add(i * step);
  out.short = short.result();

  // Nothing at all.
  out.silent = new FlowScorer(beat, 60).result();

  // Two onsets closer than a thirty-second note are one syllable seen twice.
  let doubled = new FlowScorer(beat, 60);
  doubled.add(1.0);
  doubled.add(1.0 + step / 4);
  out.doubled = doubled.result();

  // Error is measured to the nearest gridline, so it never exceeds half a step.
  out.worstError = gridErrorSeconds(0.0625, beat);
  out.onGrid = gridErrorSeconds(0.25, beat);
  return out;
})()
"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto(APP, wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(2500)
    r = page.evaluate(SCRIPT)

    check("a perfectly timed minute scores near 100",
          r["tight"]["score"] >= 95, f'score={r["tight"]["score"]}')
    check("every syllable counts as on beat when dead on",
          r["tight"]["onBeat"] == r["tight"]["total"],
          f'{r["tight"]["onBeat"]}/{r["tight"]["total"]}')
    check("landing between the gridlines scores badly",
          r["sloppy"]["score"] <= 15, f'score={r["sloppy"]["score"]}')
    check("nothing off the grid counts as on beat",
          r["sloppy"]["onBeat"] == 0, f'onBeat={r["sloppy"]["onBeat"]}')
    check("a tight but short turn cannot beat a tight full one",
          r["short"]["score"] < r["tight"]["score"],
          f'short={r["short"]["score"]} full={r["tight"]["score"]}')
    check("silence scores zero", r["silent"]["score"] == 0)
    check("a doubled onset is counted once", r["doubled"]["total"] == 1,
          f'total={r["doubled"]["total"]}')
    check("error is measured to the nearest gridline",
          abs(r["worstError"] - 0.0625) < 1e-6, f'{r["worstError"]}')
    check("an onset on a gridline has no error",
          r["onGrid"] < 1e-6, f'{r["onGrid"]}')
    # A bar is four beats, so at 120bpm it is two seconds: a minute is 30 bars.
    check("bar count follows the tempo",
          abs(r["tight"]["bars"] - 29.9) < 0.4, f'bars={r["tight"]["bars"]}')

    browser.close()

print("\n" + "=" * 50)
bad = [n for n, ok, _ in res if not ok]
print(f"{len(res) - len(bad)}/{len(res)} passed")
if bad:
    print("FAILED:", bad)
raise SystemExit(1 if bad else 0)
