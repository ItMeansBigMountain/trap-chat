// Trap Chat — Ad Policy
// When an ad is allowed to appear. Rules only, no UI, so they can be tested
// by feeding a clock and a history rather than by watching a screen.
//
// The reasoning behind every number is in ADS.md. The short version: this
// product's core loop is swipe-to-skip, so "an ad between every chat" would
// mean an ad every twenty seconds, roughly three times more often than the
// most aggressive pattern the industry has measured retention damage from.
// The placement in the brief was right; the frequency had to become a cap.

export type Viewer = 'guest' | 'account';

export interface AdRules {
  /** Milliseconds that must pass since the last ad. */
  minGapMs: number;
  /** Matches that must have been played since the last ad. */
  minMatches: number;
}

export const RULES: Record<Viewer, AdRules> = {
  // A guest sees ads more often than an account holder. That difference is
  // the pitch: it is stated in the break itself, and it converts.
  guest: { minGapMs: 3 * 60_000, minMatches: 3 },
  account: { minGapMs: 8 * 60_000, minMatches: 6 },
};

/** An ad cannot be dismissed before this, and must be dismissible after it. */
export const SKIP_AFTER_MS = 5_000;

/**
 * Nothing at all in the first minute. An app that opens with an ad is the
 * cheapest possible way to lose somebody who has not yet learned what it is.
 */
export const GRACE_MS = 60_000;

export interface AdState {
  /** When this session started. */
  startedAt: number;
  /** When the last ad was shown, or null if none yet. */
  lastAdAt: number | null;
  /** Matches finished since the last ad. */
  matchesSinceAd: number;
}

export function freshState(now: number): AdState {
  return { startedAt: now, lastAdAt: null, matchesSinceAd: 0 };
}

/**
 * Is an ad due? Both conditions have to hold, not either: the gap *and* the
 * match count. Requiring only the timer would punish a fast skipper for
 * enjoying the product, which is the behaviour we want more of.
 *
 * `inMatch` is the veto that matters most. Interrupting someone mid-task is
 * dramatically more intrusive than catching them at a boundary, so an ad
 * never appears during a live chat or match, only in the gap between them.
 */
export function adIsDue(
  state: AdState,
  viewer: Viewer,
  now: number,
  inMatch: boolean,
): boolean {
  if (inMatch) return false;
  if (now - state.startedAt < GRACE_MS) return false;

  const rules = RULES[viewer];
  if (state.matchesSinceAd < rules.minMatches) return false;

  // Never having seen one still has to clear the grace period above, which it
  // has by here.
  if (state.lastAdAt === null) return true;
  return now - state.lastAdAt >= rules.minGapMs;
}

/** A match ended. */
export function recordMatch(state: AdState): AdState {
  return { ...state, matchesSinceAd: state.matchesSinceAd + 1 };
}

/**
 * An ad was shown. A house ad counts: the viewer was interrupted either way,
 * and treating an unfilled slot as free is how apps end up interrupting
 * constantly.
 */
export function recordAd(state: AdState, now: number): AdState {
  return { ...state, lastAdAt: now, matchesSinceAd: 0 };
}

// Test seam, matching the rep and punch counters.
declare global {
  // eslint-disable-next-line no-var
  var __trapChatAdPolicy:
    | {
        adIsDue: typeof adIsDue;
        recordMatch: typeof recordMatch;
        recordAd: typeof recordAd;
        freshState: typeof freshState;
        RULES: typeof RULES;
        SKIP_AFTER_MS: number;
        GRACE_MS: number;
      }
    | undefined;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__trapChatAdPolicy = {
    adIsDue,
    recordMatch,
    recordAd,
    freshState,
    RULES,
    SKIP_AFTER_MS,
    GRACE_MS,
  };
}
