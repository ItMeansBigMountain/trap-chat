// Trap Chat — Rep Counter
// Turns a stream of pose landmarks into a rep count. Kept free of any camera
// or MediaPipe dependency so the counting rules can be tested by feeding it
// synthetic joint angles.

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
  /** Why a frame was ignored, for showing the player what to fix. */
  hint?: string;
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

const MIN_VISIBILITY = 0.5;
// Nobody travels all the way down and back up in under a third of a second.
// Anything faster is the pose jittering across a threshold, not a rep. This is
// measured as time spent at the bottom rather than time since the last rep:
// keyed off the previous rep, the very first jitter still counted once.
const MIN_DESCENT_MS = 350;

export class RepCounter {
  private spec: ExerciseSpec;
  private stage: Stage = 'up';
  private count = 0;
  private wentDownAt = 0;

  constructor(spec: ExerciseSpec) {
    this.spec = spec;
  }

  reset(): void {
    this.stage = 'up';
    this.count = 0;
    this.wentDownAt = 0;
  }

  get reps(): number {
    return this.count;
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
    const angle = Math.max(...angles);

    let counted = false;
    if (this.stage === 'up' && angle <= this.spec.downAngle) {
      this.stage = 'down';
      this.wentDownAt = now;
    } else if (this.stage === 'down' && angle >= this.spec.upAngle) {
      this.stage = 'up';
      if (now - this.wentDownAt >= MIN_DESCENT_MS) {
        this.count += 1;
        counted = true;
      }
    }

    return { count: this.count, stage: this.stage, angle, counted };
  }
}

// Test seam: the smoke suite drives these rules from the browser with
// synthetic landmarks, which needs no camera and no MediaPipe download.
declare global {
  // eslint-disable-next-line no-var
  var __trapChatRepCounter: { RepCounter: typeof RepCounter; EXERCISES: typeof EXERCISES; angleAt: typeof angleAt } | undefined;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__trapChatRepCounter = { RepCounter, EXERCISES, angleAt };
}
