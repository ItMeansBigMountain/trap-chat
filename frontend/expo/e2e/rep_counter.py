#!/usr/bin/env python3
"""Trap Chat — rep counting unit tests.

Runs the real counting rules in a real browser, driven with synthetic joint
positions. No camera and no pose model needed, so this is fast enough to run on
every build while still testing the shipped code rather than a copy of it.

Frames are fed the way a camera produces them: each phase of the movement is
held for several frames. The counter smooths the joint angle before applying
any threshold, because pose landmarks jitter, so a single-frame jump from
straight to bent is not a movement any real body makes.

    python e2e/rep_counter.py                 # against a local build
    python e2e/rep_counter.py https://<host>/

Requires: pip install playwright && playwright install chromium
"""

import sys

from playwright.sync_api import sync_playwright

DEFAULT_TARGET = "http://127.0.0.1:8100/"

DRIVER = """
(input) => {
  const mod = globalThis.__trapChatRepCounter;
  if (!mod) return { error: 'rep counter not exposed on this build' };

  const blank = () => {
    const landmarks = [];
    for (let i = 0; i < 33; i++) landmarks.push({ x: 0, y: 0, visibility: 1 });
    return landmarks;
  };

  // Elbow at the origin with the shoulder straight above it, wrist swung round
  // to make the asked-for angle. The body line is built separately: shoulder,
  // hip and ankle laid out so the angle at the hip is exactly bodyDeg.
  function pushupPose(elbowDeg, bodyDeg) {
    const l = blank();
    const e = (elbowDeg * Math.PI) / 180;
    l[13] = { x: 0, y: 0, visibility: 1 };
    l[11] = { x: 0, y: -1, visibility: 1 };
    l[15] = { x: Math.sin(e), y: -Math.cos(e), visibility: 1 };
    l[14] = l[13]; l[12] = l[11]; l[16] = l[15];

    const b = (bodyDeg * Math.PI) / 180;
    const hip = { x: 1, y: -1, visibility: 1 };
    l[23] = hip; l[24] = hip;
    // Direction from the hip to the shoulder is (-1, 0); rotate it by bodyDeg.
    const ankle = { x: hip.x - 2 * Math.cos(b), y: hip.y + 2 * Math.sin(b), visibility: 1 };
    l[27] = ankle; l[28] = ankle;
    return l;
  }

  // Hips at hipY, torso one unit tall, knee half a unit below the hip, ankle
  // swung to make the knee angle. Dropping hipY is what makes a squat deep.
  function squatPose(kneeDeg, hipY) {
    const l = blank();
    const k = (kneeDeg * Math.PI) / 180;
    const shoulder = { x: 0, y: hipY - 1, visibility: 1 };
    const hip = { x: 0, y: hipY, visibility: 1 };
    const knee = { x: 0, y: hipY + 0.5, visibility: 1 };
    const ankle = {
      x: knee.x + 0.5 * Math.sin(k),
      y: knee.y - 0.5 * Math.cos(k),
      visibility: 1,
    };
    l[11] = shoulder; l[12] = shoulder;
    l[23] = hip; l[24] = hip;
    l[25] = knee; l[26] = knee;
    l[27] = ankle; l[28] = ankle;
    return l;
  }

  // Play a phase for enough frames that the smoothed angle settles there.
  function play(counter, poses, framesPerPhase, stepMs) {
    let clock = 0;
    for (const pose of poses) {
      for (let i = 0; i < framesPerPhase; i++) {
        clock += stepMs;
        counter.update(pose, clock);
      }
    }
    return counter.reps;
  }

  const out = {};
  const P = mod.EXERCISES.pushups;
  const S = mod.EXERCISES.squats;
  const STRAIGHT = 175;      // a good plank
  const SAGGING = 130;       // hips dropped, or piked

  // --- PUSH-UPS ---
  out.three_reps = play(new mod.RepCounter(P),
    [pushupPose(170, STRAIGHT), pushupPose(70, STRAIGHT),
     pushupPose(170, STRAIGHT), pushupPose(70, STRAIGHT),
     pushupPose(170, STRAIGHT), pushupPose(70, STRAIGHT),
     pushupPose(170, STRAIGHT)], 8, 60);

  out.held_at_bottom = play(new mod.RepCounter(P),
    [pushupPose(170, STRAIGHT), pushupPose(70, STRAIGHT),
     pushupPose(70, STRAIGHT), pushupPose(70, STRAIGHT)], 8, 60);

  out.half_reps = play(new mod.RepCounter(P),
    [pushupPose(170, STRAIGHT), pushupPose(120, STRAIGHT),
     pushupPose(170, STRAIGHT), pushupPose(120, STRAIGHT)], 8, 60);

  out.no_movement = play(new mod.RepCounter(P),
    [pushupPose(170, STRAIGHT), pushupPose(170, STRAIGHT)], 8, 60);

  // Same movement, but the body is bent the whole way. Not a push-up.
  out.sagging_body = play(new mod.RepCounter(P),
    [pushupPose(170, SAGGING), pushupPose(70, SAGGING),
     pushupPose(170, SAGGING), pushupPose(70, SAGGING),
     pushupPose(170, SAGGING)], 8, 60);

  // Jitter far faster than a body moves. Two frames per phase at 20ms.
  out.jitter = play(new mod.RepCounter(P),
    [pushupPose(170, STRAIGHT), pushupPose(70, STRAIGHT),
     pushupPose(170, STRAIGHT), pushupPose(70, STRAIGHT),
     pushupPose(170, STRAIGHT)], 2, 20);

  // The refusal has to say why, or the player cannot fix it.
  const sagCounter = new mod.RepCounter(P);
  play(sagCounter, [pushupPose(170, SAGGING), pushupPose(70, SAGGING)], 8, 60);
  const sagFrame = sagCounter.update(pushupPose(170, SAGGING), 100000);
  out.sag_hint = sagFrame.hint || '';

  // --- SQUATS ---
  // Standing at 0, hips drop 0.35 of a torso. Deep enough.
  out.deep_squats = play(new mod.RepCounter(S),
    [squatPose(175, 0), squatPose(80, 0.35),
     squatPose(175, 0), squatPose(80, 0.35),
     squatPose(175, 0)], 8, 60);

  // Knees bend the same amount but the hips barely move. Not a squat.
  out.shallow_squats = play(new mod.RepCounter(S),
    [squatPose(175, 0), squatPose(80, 0.04),
     squatPose(175, 0), squatPose(80, 0.04),
     squatPose(175, 0)], 8, 60);

  // --- HELPERS ---
  out.__rightAngle = Math.round(
    mod.angleAt({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 1, y: 0 })
  );
  // Torso length is what every distance threshold is measured against, so it
  // has to be the shoulder-to-hip span and nothing else.
  const torsoPose = squatPose(175, 0);
  out.__torso = Number(mod.torsoLength(torsoPose).toFixed(3));

  const hidden = [];
  for (let i = 0; i < 33; i++) hidden.push({ x: 0, y: 0, visibility: 0 });
  const blind = new mod.RepCounter(P);
  const blindUpdate = blind.update(hidden, 1000);
  out.__hiddenCount = blind.reps;
  out.__hiddenHint = Boolean(blindUpdate.hint);
  return out;
}
"""

EXPECTED = {
    "three_reps": 3,
    "held_at_bottom": 0,
    "half_reps": 0,
    "no_movement": 0,
    "sagging_body": 0,
    "jitter": 0,
    "deep_squats": 2,
    "shallow_squats": 0,
}

LABELS = {
    "three_reps": "three full push-ups count as three",
    "held_at_bottom": "parking at the bottom counts nothing",
    "half_reps": "half reps count nothing",
    "no_movement": "no movement counts nothing",
    "sagging_body": "a bent body is not a push-up",
    "jitter": "jitter across the thresholds counts nothing",
    "deep_squats": "two deep squats count as two",
    "shallow_squats": "a knee bend with no depth is not a squat",
}


def main() -> int:
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TARGET
    print(f"rep counter target: {target}\n")
    results: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        results.append((name, ok, detail))
        line = f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  |  {detail}" if detail else "")
        # Emoji in the app, cp1252 in the console. Printing raw ended the
        # whole run with a UnicodeEncodeError that read like a real failure.
        print(line.encode("ascii", "replace").decode("ascii"), flush=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(target, wait_until="networkidle", timeout=90000)
        page.wait_for_timeout(2500)
        out = page.evaluate(DRIVER, {})
        browser.close()

    if isinstance(out, dict) and out.get("error"):
        print(f"FAIL  {out['error']}")
        return 1

    for key, expected in EXPECTED.items():
        got = out.get(key)
        check(LABELS[key], got == expected, f"got {got}, expected {expected}")

    check("a right angle reads as 90 degrees", out.get("__rightAngle") == 90,
          f"got {out.get('__rightAngle')}")
    check("torso length is the shoulder to hip span", abs(out.get("__torso", 0) - 1.0) < 0.01,
          f"got {out.get('__torso')}")
    check("a body out of frame counts nothing", out.get("__hiddenCount") == 0)
    check("a body out of frame says why", out.get("__hiddenHint") is True)
    check("a refused rep explains the fault",
          "straight" in (out.get("sag_hint") or "").lower(),
          f"hint was {out.get('sag_hint')!r}")

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
