#!/usr/bin/env python3
"""Trap Chat — profanity filter and facial symmetry unit tests.

Both are pure logic driven in a real browser with synthetic input, the same
way the rep, punch and flow rules are tested: no camera, no model download,
and the shipped code rather than a copy of it.

The filter needs testing in both directions. Missing a word is a small
failure; censoring an ordinary one is a worse and much more visible failure,
so the innocent words get as many cases as the profane ones.

    python e2e/profanity_and_face.py                 # against a local build
    python e2e/profanity_and_face.py https://<host>/

Requires: pip install playwright && playwright install chromium
"""

import sys

from playwright.sync_api import sync_playwright

DEFAULT_TARGET = "http://127.0.0.1:8100/"

DRIVER = """
() => {
  const prof = globalThis.__trapChatProfanity;
  const face = globalThis.__trapChatFaceScorer;
  if (!prof) return { error: 'profanity filter not exposed on this build' };
  if (!face) return { error: 'face scorer not exposed on this build' };

  const out = { clean: {}, face: {} };

  const cases = {
    plain: 'what the fuck was that',
    caps: 'What the FUCK',
    leet: 'what the sh1t',
    stretched: 'fuuuuuck',
    punctuated: 'fuck!',
    // Innocent words that a careless filter mangles.
    scunthorpe: 'I live in Scunthorpe',
    classic: 'pass me the shitake mushrooms',
    assume: 'assume nothing',
    grass: 'the grass is wet',
    clean_sentence: 'good game, well played',
  };
  for (const [name, text] of Object.entries(cases)) out.clean[name] = prof.clean(text);

  out.offKeepsText = prof.filterIf(false, 'what the fuck');
  out.onMasks = prof.filterIf(true, 'what the fuck');

  // --- FACE SYMMETRY ---
  // A synthetic face: midline points on x=0, and every pair mirrored about it.
  function makeFace(skew) {
    const f = [];
    for (let i = 0; i < 478; i++) f.push({ x: 0, y: 0 });
    // Midline, top to bottom.
    f[10] = { x: 0, y: -1 };
    f[168] = { x: 0, y: -0.5 };
    f[1] = { x: 0, y: 0 };
    f[152] = { x: 0, y: 1 };
    // Mirrored pairs. `skew` pushes the left side out, breaking symmetry.
    const pairs = [[33, 263, 0.5, -0.4], [133, 362, 0.2, -0.4], [70, 300, 0.45, -0.6],
                   [105, 334, 0.25, -0.65], [234, 454, 0.75, -0.1], [129, 358, 0.12, 0.05],
                   [61, 291, 0.3, 0.45], [172, 397, 0.6, 0.6], [58, 288, 0.5, 0.75],
                   [143, 372, 0.55, -0.25]];
    for (const [l, r, dx, y] of pairs) {
      f[l] = { x: -dx - skew, y };
      f[r] = { x: dx, y };
    }
    return f;
  }

  out.face.perfect = face.scoreFace(makeFace(0)).score;
  out.face.slight = face.scoreFace(makeFace(0.02)).score;
  out.face.crooked = face.scoreFace(makeFace(0.12)).score;
  out.face.width = Number(face.faceWidth(makeFace(0)).toFixed(3));

  // Scale free: the same face closer to the camera scores the same.
  const scaled = makeFace(0).map((p) => ({ x: p.x * 3, y: p.y * 3 }));
  out.face.scaled = face.scoreFace(scaled).score;

  // Nothing detected scores nothing rather than a lucky number.
  out.face.empty = face.scoreFace([]).score;

  // The run takes a median, so one bad frame cannot decide a match.
  const run = new face.FaceRun();
  for (let i = 0; i < 20; i++) run.add(makeFace(0));
  run.add(makeFace(0.5));            // one terrible frame
  out.face.median = run.result();
  out.face.samples = run.count;
  return out;
}
"""


def main() -> int:
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TARGET
    print(f"target: {target}\n")
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
        out = page.evaluate(DRIVER)
        browser.close()

    if isinstance(out, dict) and out.get("error"):
        print(f"FAIL  {out['error']}")
        return 1

    c = out["clean"]
    check("a plain swear is masked", "fuck" not in c["plain"], c["plain"])
    check("shouting is masked too", "FUCK" not in c["caps"], c["caps"])
    check("letter substitution is masked", "sh1t" not in c["leet"], c["leet"])
    check("a stretched swear is masked", "fuuuuuck" not in c["stretched"], c["stretched"])
    check("punctuation does not hide it", "fuck" not in c["punctuated"], c["punctuated"])

    # The half that matters more: not mangling ordinary words.
    check("Scunthorpe survives", c["scunthorpe"] == "I live in Scunthorpe", c["scunthorpe"])
    check("shiitake survives", c["classic"] == "pass me the shitake mushrooms", c["classic"])
    check("assume survives", c["assume"] == "assume nothing", c["assume"])
    check("grass survives", c["grass"] == "the grass is wet", c["grass"])
    check("a clean sentence is untouched",
          c["clean_sentence"] == "good game, well played", c["clean_sentence"])
    check("the sentence keeps its shape", " " in c["plain"] and len(c["plain"]) == len("what the fuck was that"), c["plain"])

    check("turning it off leaves text alone", out["offKeepsText"] == "what the fuck")
    check("turning it on masks", "fuck" not in out["onMasks"], out["onMasks"])

    f = out["face"]
    check("a symmetric face scores full marks", f["perfect"] == 100, str(f["perfect"]))
    check("a crooked face scores less than a slight one",
          f["crooked"] < f["slight"] < f["perfect"], str(f))
    check("a badly crooked face scores poorly", f["crooked"] < 50, str(f["crooked"]))
    check("the score is scale free", f["scaled"] == f["perfect"], str(f))
    check("no face scores nothing", f["empty"] == 0, str(f["empty"]))
    check("one bad frame cannot drag the result", f["median"] == 100, str(f))
    check("every frame is sampled", f["samples"] == 21, str(f["samples"]))

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
