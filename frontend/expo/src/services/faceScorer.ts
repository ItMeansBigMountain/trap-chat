// Trap Chat — Face Scorer
// Turns face landmarks into a symmetry score.
//
// What this measures is symmetry, and the screen says so. A model cannot rank
// faces by how good they look, and building something that claims to would be
// dishonest as well as unpleasant. Bilateral symmetry is a real geometric
// property of a face, it is measurable from landmarks, and it is what the
// original "Facial Symmetry" idea was before it got renamed.
//
// The method: find the facial midline from the points that sit on it, measure
// how far each left/right pair sits from that line, and compare the two. A
// perfectly symmetric face has every pair equidistant.
//
// Kept free of MediaPipe so the maths can be tested with synthetic faces.

export interface FacePoint {
  x: number;
  y: number;
}

// MediaPipe Face Landmarker indices. These sit on the facial midline, so the
// line through them is the axis everything else is measured against.
const MIDLINE = [10, 168, 1, 152];

// Left/right pairs that are mirror images on a symmetric face. Chosen to
// spread across the face rather than cluster: eyes, brows, cheeks, mouth, jaw.
const PAIRS: [number, number][] = [
  [33, 263],   // outer eye corners
  [133, 362],  // inner eye corners
  [70, 300],   // eyebrow outer
  [105, 334],  // eyebrow centre
  [234, 454],  // cheekbones
  [129, 358],  // nostrils
  [61, 291],   // mouth corners
  [172, 397],  // jaw
  [58, 288],   // lower jaw
  [143, 372],  // under-eye
];

export interface FaceScore {
  /** 0-100. Higher is more symmetric. */
  score: number;
  /** Mean asymmetry as a fraction of face width, before scaling. */
  asymmetry: number;
  /** How many pairs could be measured. */
  pairs: number;
}

/** Distance from point p to the infinite line through a and b. */
function distanceToLine(p: FacePoint, a: FacePoint, b: FacePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return 0;
  // Signed cross product over length: the sign tells us which side.
  return ((p.x - a.x) * dy - (p.y - a.y) * dx) / length;
}

/**
 * The widest measurable span across the face, used to make the score scale
 * free: a face close to the camera must not score differently from the same
 * face further away.
 */
export function faceWidth(points: FacePoint[]): number {
  const left = points[234];
  const right = points[454];
  if (left && right) return Math.hypot(left.x - right.x, left.y - right.y);
  return 0;
}

// Asymmetry at or above this fraction of face width scores zero. Real faces
// are never perfectly symmetric, so the scale has to be generous enough that
// ordinary faces land in the upper range and differences still separate them.
const WORST_ASYMMETRY = 0.06;

export function scoreFace(points: FacePoint[]): FaceScore {
  const top = points[MIDLINE[0]];
  const bottom = points[MIDLINE[MIDLINE.length - 1]];
  const width = faceWidth(points);
  if (!top || !bottom || width === 0) {
    return { score: 0, asymmetry: 1, pairs: 0 };
  }

  let total = 0;
  let counted = 0;
  for (const [leftIndex, rightIndex] of PAIRS) {
    const left = points[leftIndex];
    const right = points[rightIndex];
    if (!left || !right) continue;
    // Signed distances: on a symmetric face these are equal and opposite, so
    // their sum is the asymmetry. Using unsigned distances would call a face
    // with both eyes shifted the same way perfectly symmetric.
    const dl = distanceToLine(left, top, bottom);
    const dr = distanceToLine(right, top, bottom);
    total += Math.abs(dl + dr) / width;
    counted += 1;
  }

  if (counted === 0) return { score: 0, asymmetry: 1, pairs: 0 };
  const asymmetry = total / counted;
  const score = Math.round(
    Math.max(0, Math.min(100, (1 - asymmetry / WORST_ASYMMETRY) * 100)),
  );
  return { score, asymmetry, pairs: counted };
}

/**
 * A running score over a whole turn. One frame is noisy and one lucky frame
 * should not decide a match, so the result is the median of what was seen.
 */
export class FaceRun {
  private samples: number[] = [];

  add(points: FacePoint[]): FaceScore {
    const result = scoreFace(points);
    if (result.pairs > 0) this.samples.push(result.score);
    return result;
  }

  get count(): number {
    return this.samples.length;
  }

  /** The median, which a few bad frames cannot drag around. */
  result(): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  reset(): void {
    this.samples = [];
  }
}

// Test seam, matching the other analysers.
declare global {
  // eslint-disable-next-line no-var
  var __trapChatFaceScorer:
    | { scoreFace: typeof scoreFace; FaceRun: typeof FaceRun; faceWidth: typeof faceWidth; PAIRS: typeof PAIRS; MIDLINE: typeof MIDLINE }
    | undefined;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__trapChatFaceScorer = { scoreFace, FaceRun, faceWidth, PAIRS, MIDLINE };
}
