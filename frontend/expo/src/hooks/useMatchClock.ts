// How long is left in a match.
//
// Counted down from a deadline rather than by decrementing state, because the
// nav is now reachable during a match: leaving the page and coming back
// unmounts the screen, and a counter held in component state restarted from
// full every time. The deadline is per match and outlives the component, so
// the clock is the same one you left.

import { useEffect, useState } from 'react';

// Module scope on purpose: this has to survive the screen unmounting, which
// is the entire problem it solves.
const DEADLINES = new Map<number, number>();

function deadlineFor(matchId: number, durationSec: number): number {
  const existing = DEADLINES.get(matchId);
  if (existing !== undefined) return existing;
  const deadline = Date.now() + durationSec * 1000;
  DEADLINES.set(matchId, deadline);
  return deadline;
}

/** Seconds remaining, never below zero. Ticks once a second. */
export function useMatchClock(matchId: number | undefined, durationSec: number): number {
  const [left, setLeft] = useState(() =>
    matchId === undefined ? durationSec : secondsUntil(deadlineFor(matchId, durationSec)),
  );

  useEffect(() => {
    if (matchId === undefined) return;
    const deadline = deadlineFor(matchId, durationSec);
    setLeft(secondsUntil(deadline));
    if (secondsUntil(deadline) <= 0) return;
    const tick = setInterval(() => {
      const remaining = secondsUntil(deadline);
      setLeft(remaining);
      if (remaining <= 0) clearInterval(tick);
    }, 250);
    return () => clearInterval(tick);
  }, [matchId, durationSec]);

  return left;
}

function secondsUntil(deadline: number): number {
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

/** Forget a match's deadline once it is over, so the map cannot grow forever. */
export function clearMatchClock(matchId: number | undefined): void {
  if (matchId !== undefined) DEADLINES.delete(matchId);
}
