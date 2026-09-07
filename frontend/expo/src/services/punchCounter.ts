// Trap Chat — Punch Counter
// Turns a stream of pose landmarks into punches, a combo and a score.
//
// A punch is not a rep, and counting one like the other does not work:
//
//   * the two arms are independent. A rep counter has one state machine; this
//     needs two, or a one-two combination reads as a single movement
//   * speed is the whole difference between a punch and reaching for a glass.
//     Extension has to happen inside a window, not just eventually
//   * a punch has to be pulled back before it can be thrown again, or holding
//     your arm out scores forever
//
// Kept free of any camera or MediaPipe dependency so the rules can be tested
// with synthetic joint positions.

import { Landmark, angleAt } from './repCounter';

const L_SHOULDER = 11, R_SHOULDER = 12;
const L_ELBOW = 13, R_ELBOW = 14;
const L_WRIST = 15, R_WRIST = 16;

export type Hand = 'left' | 'right';

export interface PunchUpdate {
  /** Total punches thrown. */
  punches: number;
  /** Punches in the current unbroken combo. */
  combo: number;
  /** What each punch is currently worth. */
  multiplier: number;
  /** Punches times their multiplier at the time they landed. */
  score: number;
  /** Set only on the frame a punch landed, so callers can react once. */
  landed?: Hand;
  /** Why nothing is being counted. */
  hint?: string;
}

// Elbow angles. Below the guard the arm is cocked; above the extend it is out.
const GUARD_ANGLE = 100;
const EXTEND_ANGLE = 150;
// A punch is fast. Take longer than this to straighten your arm and you are
// reaching, not punching, which is what stops slow waving from scoring.
const MAX_EXTEND_MS = 600;
// Nobody throws the same hand more often than this.
const MIN_SAME_HAND_GAP_MS = 150;
// Let the combo survive a breath between punches, but not a rest.
export const COMBO_WINDOW_MS = 2000;
// Every this many unbroken punches, the multiplier goes up one.
export const PUNCHES_PER_MULTIPLIER = 10;
// Past this the numbers stop meaning anything.
export const MAX_MULTIPLIER = 5;

const MIN_VISIBILITY = 0.5;

interface ArmState {
  /** Is the arm cocked and ready, or already thrown? */
  stage: 'guard' | 'out';
  /** When the arm last left the guard angle, for the speed gate. */
  leftGuardAt: number;
  /** When this hand last landed a punch. */
  lastPunchAt: number;
}

/** How many punches are worth one point each at this combo length. */
export function multiplierFor(combo: number): number {
  return Math.min(MAX_MULTIPLIER, 1 + Math.floor(combo / PUNCHES_PER_MULTIPLIER));
}

export class PunchCounter {
  private arms: Record<Hand, ArmState> = {
    left: { stage: 'guard', leftGuardAt: 0, lastPunchAt: -Infinity },
    right: { stage: 'guard', leftGuardAt: 0, lastPunchAt: -Infinity },
  };
  private punches = 0;
  private combo = 0;
  private score = 0;
  private lastAnyPunchAt = -Infinity;

  reset(): void {
    this.arms = {
      left: { stage: 'guard', leftGuardAt: 0, lastPunchAt: -Infinity },
      right: { stage: 'guard', leftGuardAt: 0, lastPunchAt: -Infinity },
    };
    this.punches = 0;
    this.combo = 0;
    this.score = 0;
    this.lastAnyPunchAt = -Infinity;
  }

  get total(): number {
    return this.punches;
  }

  get points(): number {
    return this.score;
  }

  get multiplier(): number {
    return multiplierFor(this.combo);
  }

  private armAngle(landmarks: Landmark[], hand: Hand): number | null {
    const [s, e, w] = hand === 'left'
      ? [landmarks[L_SHOULDER], landmarks[L_ELBOW], landmarks[L_WRIST]]
      : [landmarks[R_SHOULDER], landmarks[R_ELBOW], landmarks[R_WRIST]];
    if (!s || !e || !w) return null;
    const visible = [s, e, w].every(
      (p) => p.visibility === undefined || p.visibility >= MIN_VISIBILITY,
    );
    if (!visible) return null;
    return angleAt(s, e, w);
  }

  /**
   * Feed one frame. A punch lands on the extension, not the retraction: that
   * is the moment it would connect, and waiting for the pull-back would put
   * the count behind what the player sees.
   */
  update(landmarks: Landmark[], now: number = Date.now()): PunchUpdate {
    // The combo is broken by time, whether or not a frame says anything.
    if (this.combo > 0 && now - this.lastAnyPunchAt > COMBO_WINDOW_MS) {
      this.combo = 0;
    }

    let landed: Hand | undefined;
    let seen = 0;

    for (const hand of ['left', 'right'] as Hand[]) {
      const angle = this.armAngle(landmarks, hand);
      if (angle === null) continue;
      seen += 1;
      const arm = this.arms[hand];

      if (arm.stage === 'guard') {
        // The clock starts the moment the arm begins to straighten.
        if (angle > GUARD_ANGLE && arm.leftGuardAt === 0) arm.leftGuardAt = now;
        if (angle <= GUARD_ANGLE) arm.leftGuardAt = 0;

        if (angle >= EXTEND_ANGLE) {
          const quickEnough = arm.leftGuardAt === 0 || now - arm.leftGuardAt <= MAX_EXTEND_MS;
          const rested = now - arm.lastPunchAt >= MIN_SAME_HAND_GAP_MS;
          arm.stage = 'out';
          arm.leftGuardAt = 0;
          if (quickEnough && rested) {
            arm.lastPunchAt = now;
            this.punches += 1;
            this.combo += 1;
            this.lastAnyPunchAt = now;
            // The multiplier is read after the punch is added, so the tenth
            // punch of a combo is the one that pays the new rate.
            this.score += multiplierFor(this.combo);
            landed = hand;
          }
        }
      } else if (angle <= GUARD_ANGLE) {
        // Pulled back. Ready to throw again.
        arm.stage = 'guard';
        arm.leftGuardAt = 0;
      }
    }

    if (seen === 0) {
      return {
        punches: this.punches,
        combo: this.combo,
        multiplier: this.multiplier,
        score: this.score,
        hint: 'Step back so both arms are in frame',
      };
    }

    return {
      punches: this.punches,
      combo: this.combo,
      multiplier: this.multiplier,
      score: this.score,
      landed,
    };
  }
}

// Test seam, the same one the rep counter uses: the browser tests drive these
// rules directly rather than trying to box in front of a headless Chrome.
declare global {
  // eslint-disable-next-line no-var
  var __trapChatPunchCounter:
    | {
        PunchCounter: typeof PunchCounter;
        multiplierFor: typeof multiplierFor;
        COMBO_WINDOW_MS: number;
        PUNCHES_PER_MULTIPLIER: number;
        MAX_MULTIPLIER: number;
      }
    | undefined;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__trapChatPunchCounter = {
    PunchCounter,
    multiplierFor,
    COMBO_WINDOW_MS,
    PUNCHES_PER_MULTIPLIER,
    MAX_MULTIPLIER,
  };
}
