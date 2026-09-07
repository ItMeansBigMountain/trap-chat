// Trap Chat — Rep Counter
// Turns a stream of pose landmarks into a rep count. Kept free of any camera
// or MediaPipe dependency so the counting rules can be tested by feeding it
// synthetic joint angles.
//
// The rules follow what the pose-estimation literature actually recommends
// rather than the obvious one-angle approach:
//
//   * a joint angle alone counts a "push-up" done on your knees with your hips
//     in the air, so form is gated as well as measured
//   * BlazePose joint angles are noisy enough that only about 43% of frames
//     land within 5 degrees during a push-up, so the angle is smoothed before
//     any threshold is applied
//   * distances are normalised by torso length, or the thresholds only work at
//     one distance from the camera
//
// Google's own pose-classification work for these two exercises adds a k-NN
// classifier over pose embeddings on top of this. That needs a labelled sample
// set to ship; the geometry here is the part that works without one.

export interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export type Stage = 'up' | 'down';

export interface RepUpdate {
  count: number;
  stage: Stage;
  angle: number;
  /** True only on the frame a rep completed, so callers can react once. */
  counted: boolean;
  /** Why a frame was ignored, or why a rep did not count. */
  hint?: string;
  /** True while the movement is happening but the form gate is failing. */
  formFault?: boolean;
}

export interface ExerciseSpec {
  slug: string;
  label: string;
  /** Landmark triples whose middle joint is measured, left and right side. */
  joints: [number, number, number][];
  /** Below this the body is at the bottom of the movement. */
  downAngle: number;
  /** Above this it is back at the top. A gap between the two is hysteresis: */
  /** without it, noise around a single threshold counts dozens of reps. */
  upAngle: number;
  /**
   * Shoulder-hip-ankle, per side. A push-up is only a push-up if the body
   * stays in a line, and this is the standard way to check it: it is what
   * separates a rep from bending your arms while your hips sag or pike.
   */
  bodyLine?: [number, number, number][];
  /** Degrees. Below this the body is bent, not straight. */
  minBodyLine?: number;
  /**
   * How far the hips must drop between the top and the bottom, as a fraction
   * of torso length. Scale free, so it holds at any distance from the camera.
   * This is the depth criterion: a small knee bend is not a squat.
   */
  minHipDrop?: number;
}

// MediaPipe Pose landmark indices.
const L_SHOULDER = 11, R_SHOULDER = 12;
const L_ELBOW = 13, R_ELBOW = 14;
const L_WRIST = 15, R_WRIST = 16;
const L_HIP = 23, R_HIP = 24;
const L_KNEE = 25, R_KNEE = 26;
const L_ANKLE = 27, R_ANKLE = 28;

export const EXERCISES: Record<string, ExerciseSpec> = {
  pushups: {
    slug: 'pushups',
    label: 'Push-Ups',
    joints: [
      [L_SHOULDER, L_ELBOW, L_WRIST],
      [R_SHOULDER, R_ELBOW, R_WRIST],
    ],
    downAngle: 95,
    upAngle: 155,
    bodyLine: [
      [L_SHOULDER, L_HIP, L_ANKLE],
      [R_SHOULDER, R_HIP, R_ANKLE],
    ],
    // A plank is not perfectly straight from a camera to the side, and the
    // ankle landmark is the least reliable of the three, so this is generous.
    minBodyLine: 150,
  },
  squats: {
    slug: 'squats',
    label: 'Squats',
    joints: [
      [L_HIP, L_KNEE, L_ANKLE],
      [R_HIP, R_KNEE, R_ANKLE],
    ],
    downAngle: 100,
    upAngle: 160,
    minHipDrop: 0.15,
  },
};

/** Interior angle at `b`, in degrees, for the path a-b-c. */
export function angleAt(a: Landmark, b: Landmark, c: Landmark): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magnitude = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (magnitude === 0) return 180;
  // Clamp: floating point can push the cosine just outside [-1, 1].
  const cosine = Math.min(1, Math.max(-1, dot / magnitude));
  return (Math.acos(cosine) * 180) / Math.PI;
}

/**
 * Shoulder-to-hip distance, averaged over whichever side is visible. Every
 * distance threshold is expressed against this so it means the same thing
 * whether you are two feet from the camera or ten.
 */
export function torsoLength(landmarks: Landmark[]): number {
  const spans: number[] = [];
  for (const [shoulder, hip] of [[L_SHOULDER, L_HIP], [R_SHOULDER, R_HIP]] as const) {
    const s = landmarks[shoulder];
    const h = landmarks[hip];
    if (s && h) spans.push(Math.hypot(s.x - h.x, s.y - h.y));
  }
  if (spans.length === 0) return 0;
  return spans.reduce((total, span) => total + span, 0) / spans.length;
}

function meanHipY(landmarks: Landmark[]): number | null {
  const ys = [landmarks[L_HIP], landmarks[R_HIP]]
    .filter((p): p is Landmark => Boolean(p))
    .map((p) => p.y);
  if (ys.length === 0) return null;
  return ys.reduce((total, y) => total + y, 0) / ys.length;
}

const MIN_VISIBILITY = 0.5;
// Nobody travels all the way down and back up in under a third of a second.
// Anything faster is the pose jittering across a threshold, not a rep. This is
// measured as time spent at the bottom rather than time since the last rep:
// keyed off the previous rep, the very first jitter still counted once.
const MIN_DESCENT_MS = 350;
// How much of each new angle to believe. Pose landmarks jitter frame to frame,
// and a threshold crossing on a single noisy frame is a phantom rep.
const ANGLE_SMOOTHING = 0.4;

export class RepCounter {
  private spec: ExerciseSpec;
  private stage: Stage = 'up';
  private count = 0;
  private wentDownAt = 0;
  private smoothed: number | null = null;
  // Hip height at the top of the current rep, and the lowest it reached.
  private hipAtTop: number | null = null;
  private lowestHip: number | null = null;
  // Set if form broke at any point during this descent.
  private faultedThisRep = false;

  constructor(spec: ExerciseSpec) {
    this.spec = spec;
  }

  reset(): void {
    this.stage = 'up';
    this.count = 0;
    this.wentDownAt = 0;
    this.smoothed = null;
    this.hipAtTop = null;
    this.lowestHip = null;
    this.faultedThisRep = false;
  }

  get reps(): number {
    return this.count;
  }

  /** Is the body held in a straight line? Only meaningful for push-ups. */
  private bodyLineAngle(landmarks: Landmark[]): number | null {
    if (!this.spec.bodyLine) return null;
    const angles: number[] = [];
    for (const [aIndex, bIndex, cIndex] of this.spec.bodyLine) {
      const a = landmarks[aIndex];
      const b = landmarks[bIndex];
      const c = landmarks[cIndex];
      if (!a || !b || !c) continue;
      angles.push(angleAt(a, b, c));
    }
    if (angles.length === 0) return null;
    // The straighter side again: one leg out of frame should not fail you.
    return Math.max(...angles);
  }

  /**
   * Feed one frame of landmarks. Returns the running count and whether this
   * frame completed a rep. A rep is the full travel down and back up, so it is
   * counted on the way up: that stops someone parking at the bottom and
   * racking up numbers.
   */
  update(landmarks: Landmark[], now: number = Date.now()): RepUpdate {
    const angles: number[] = [];
    for (const [aIndex, bIndex, cIndex] of this.spec.joints) {
      const a = landmarks[aIndex];
      const b = landmarks[bIndex];
      const c = landmarks[cIndex];
      if (!a || !b || !c) continue;
      const visible = [a, b, c].every(
        (p) => p.visibility === undefined || p.visibility >= MIN_VISIBILITY,
      );
      if (!visible) continue;
      angles.push(angleAt(a, b, c));
    }

    if (angles.length === 0) {
      return {
        count: this.count,
        stage: this.stage,
        angle: 0,
        counted: false,
        hint: 'Step back so your whole body is in frame',
      };
    }

    // Use the straighter side. A single arm out of frame should not read as a
    // permanent rep in progress.
    const raw = Math.max(...angles);
    this.smoothed = this.smoothed === null
      ? raw
      : this.smoothed + ANGLE_SMOOTHING * (raw - this.smoothed);
    const angle = this.smoothed;

    // Track how far the hips travel, for the squat depth rule.
    const hipY = meanHipY(landmarks);
    const torso = torsoLength(landmarks);
    if (hipY !== null) {
      // Only while genuinely extended. Taking this on every "up" frame meant
      // the hips had already dropped by the time the smoothed angle admitted
      // the descent had begun, so the measured drop was always near zero.
      if (this.stage === 'up' && angle >= this.spec.upAngle) this.hipAtTop = hipY;
      this.lowestHip = this.lowestHip === null ? hipY : Math.max(this.lowestHip, hipY);
    }

    // Form is judged while the movement is happening, not only at the bottom:
    // a rep that sags halfway down is still a bad rep.
    let hint: string | undefined;
    let formFault = false;
    const line = this.bodyLineAngle(landmarks);
    if (line !== null && this.spec.minBodyLine !== undefined && line < this.spec.minBodyLine) {
      formFault = true;
      hint = 'Keep your body in a straight line';
      if (this.stage === 'down') this.faultedThisRep = true;
    }

    let counted = false;
    if (this.stage === 'up' && angle <= this.spec.downAngle) {
      this.stage = 'down';
      this.wentDownAt = now;
      this.lowestHip = hipY;
      this.faultedThisRep = formFault;
    } else if (this.stage === 'down' && angle >= this.spec.upAngle) {
      this.stage = 'up';
      const quick = now - this.wentDownAt < MIN_DESCENT_MS;
      const shallow =
        this.spec.minHipDrop !== undefined &&
        torso > 0 &&
        this.hipAtTop !== null &&
        this.lowestHip !== null &&
        this.lowestHip - this.hipAtTop < this.spec.minHipDrop * torso;

      if (quick) {
        hint = 'Slow down, that was too fast to be a rep';
      } else if (this.faultedThisRep) {
        hint = 'That one did not count: keep your body straight';
      } else if (shallow) {
        hint = 'Go lower';
      } else {
        this.count += 1;
        counted = true;
      }
      this.faultedThisRep = false;
      this.lowestHip = null;
    }

    return { count: this.count, stage: this.stage, angle, counted, hint, formFault };
  }
}

// Test seam: the smoke suite drives these rules from the browser with
// synthetic landmarks, which needs no camera and no MediaPipe download.
declare global {
  // eslint-disable-next-line no-var
  var __trapChatRepCounter: {
    RepCounter: typeof RepCounter;
    EXERCISES: typeof EXERCISES;
    angleAt: typeof angleAt;
    torsoLength: typeof torsoLength;
  } | undefined;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__trapChatRepCounter = { RepCounter, EXERCISES, angleAt, torsoLength };
}
