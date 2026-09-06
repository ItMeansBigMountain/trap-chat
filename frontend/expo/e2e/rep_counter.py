#!/usr/bin/env python3
"""Trap Chat — rep counting unit tests.

Runs the real counting rules in a real browser, driven with synthetic joint
positions. No camera and no pose model needed, so this is fast enough to run on
every build while still testing the shipped code rather than a copy of it.

    python e2e/rep_counter.py                 # against a local build
    python e2e/rep_counter.py https://<host>/

Requires: pip install playwright && playwright install chromium
"""

import sys

from playwright.sync_api import sync_playwright

DEFAULT_TARGET = "http://127.0.0.1:8100/"

# Build a pose whose elbow angle is what we want. The shoulder sits directly
# above the elbow, and the wrist is placed on a circle around the elbow, so the
# interior angle is exactly the value asked for.
DRIVER = """
(cases) => {
  const mod = globalThis.__trapChatRepCounter;
  if (!mod) return { error: 'rep counter not exposed on this build' };

  function poseWithElbowAngle(degrees) {
    const rad = (degrees * Math.PI) / 180;
    const landmarks = [];
    for (let i = 0; i < 33; i++) landmarks.push({ x: 0, y: 0, visibility: 1 });
    // Elbow at the origin, shoulder straight up.
    landmarks[13] = { x: 0, y: 0, visibility: 1 };
    landmarks[11] = { x: 0, y: -1, visibility: 1 };
    landmarks[15] = { x: Math.sin(rad), y: -Math.cos(rad), visibility: 1 };
    // Mirror onto the right side so both arms agree.
    landmarks[14] = landmarks[13];
    landmarks[12] = landmarks[11];
    landmarks[16] = landmarks[15];
    return landmarks;
  }

  const out = {};
  for (const [name, spec] of Object.entries(cases)) {
    const counter = new mod.RepCounter(mod.EXERCISES.pushups);
    let clock = 0;
    for (const angle of spec.angles) {
      clock += spec.stepMs;
      counter.update(poseWithElbowAngle(angle), clock);
    }
    out[name] = counter.reps;
  }

  // Angle helper sanity: a right angle must read as 90 degrees.
  out.__rightAngle = Math.round(
    mod.angleAt({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 1, y: 0 })
  );

  // A body out of frame must not count.
  const hidden = [];
  for (let i = 0; i < 33; i++) hidden.push({ x: 0, y: 0, visibility: 0 });
  const blind = new mod.RepCounter(mod.EXERCISES.pushups);
  const blindUpdate = blind.update(hidden, 1000);
  out.__hiddenCount = blind.reps;
  out.__hiddenHint = Boolean(blindUpdate.hint);
  return out;
}
"""

# Each case is a sequence of elbow angles, played at a given tick rate.
DOWN, UP = 70, 170
CASES = {
    # Three full travels down and back up.
    "three_reps": {"angles": [UP, DOWN, UP, DOWN, UP, DOWN, UP], "stepMs": 500},
    # Never straightens: at the bottom the whole time.
    "held_at_bottom": {"angles": [UP, DOWN, DOWN, DOWN, DOWN], "stepMs": 500},
    # Shallow dips that never reach the down threshold.
    "half_reps": {"angles": [UP, 120, UP, 120, UP, 120], "stepMs": 500},
    # Jitter across the thresholds faster than a human can move.
    "jitter": {"angles": [UP, DOWN, UP, DOWN, UP, DOWN, UP, DOWN, UP], "stepMs": 40},
    # Nothing at all.
    "no_movement": {"angles": [UP, UP, UP, UP], "stepMs": 500},
}

EXPECTED = {
    "three_reps": 3,
    "held_at_bottom": 0,
    "half_reps": 0,
    "jitter": 0,
    "no_movement": 0,
}


def main() -> int:
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TARGET
    print(f"rep counter target: {target}\n")
    results: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        results.append((name, ok, detail))
        print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  |  {detail}" if detail else ""), flush=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(target, wait_until="networkidle", timeout=90000)
        page.wait_for_timeout(2500)
        out = page.evaluate(DRIVER, CASES)
        browser.close()

    if isinstance(out, dict) and out.get("error"):
        print(f"FAIL  {out['error']}")
        return 1

    check("angle helper reads a right angle as 90", out.get("__rightAngle") == 90, str(out.get("__rightAngle")))
    check("a body out of frame counts nothing", out.get("__hiddenCount") == 0, str(out.get("__hiddenCount")))
    check("a body out of frame explains why", out.get("__hiddenHint") is True)

    for name, expected in EXPECTED.items():
        actual = out.get(name)
        check(f"{name} counts {expected}", actual == expected, f"got {actual}")

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
