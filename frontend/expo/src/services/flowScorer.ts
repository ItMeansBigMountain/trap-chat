// Trap Chat — Flow Scorer
// Turns a stream of vocal onsets into a flow score against a known beat grid.
//
// The big simplification here is that we ship the beats, so we already know
// each one's BPM and where its first downbeat falls. Every other app in this
// space has to detect the tempo of arbitrary audio first, which is the part
// that goes wrong. We only have to detect the rapper.
//
// What this deliberately does NOT do is judge whether a bar is good. No
// algorithm can, and pretending otherwise would make the ladder meaningless.
// The audience decides who won; this measures the things a machine actually
// can measure, and breaks a tied vote.
//
// Kept free of any Web Audio dependency so the rules can be tested by feeding
// it synthetic onset times.

export interface Beat {
  slug: string;
  title: string;
  bpm: number;
  /** Seconds from the start of the file to the first downbeat. */
  offsetSec: number;
  url?: string;
}

// A rapper lands syllables on eighths and sixteenths, not just on the quarter
// note pulse, so the grid has to be finer than the beat itself. Sixteenths is
// where it stops being musically meaningful and starts rewarding noise.
export const GRID_SUBDIVISION = 4;

/** Half the gap between gridlines is the worst any onset can be. Past that it
 *  is closer to the next line, so error is always in [0, 0.5] of a step. */
export function gridErrorSeconds(timeSec: number, beat: Beat): number {
  const stepSec = 60 / beat.bpm / GRID_SUBDIVISION;
  const since = timeSec - beat.offsetSec;
  const offBy = Math.abs(since - Math.round(since / stepSec) * stepSec);
  return offBy;
}

// Inside this window an onset reads as on the grid. It is a fixed slice of the
// step rather than a fixed number of milliseconds, because what counts as
// "tight" scales with tempo: 40ms is sloppy at 70bpm and unreachable at 160.
const TIGHT_FRACTION = 0.25;

export interface FlowResult {
  /** 0-100. What gets shown, and what breaks a tied vote. */
  score: number;
  /** Onsets that landed inside the tight window. */
  onBeat: number;
  /** Every onset counted. */
  total: number;
  /** Bars actually rapped over, from the first onset to the last. */
  bars: number;
  /** 0-1, how much of the turn had rapping in it. */
  coverage: number;
  /** 0-1, mean tightness across every onset. */
  accuracy: number;
}

export class FlowScorer {
  private onsets: number[] = [];

  constructor(
    private readonly beat: Beat,
    /** How long the turn lasts, for coverage and bar count. */
    private readonly durationSec: number,
  ) {}

  /** Feed the time, in seconds from the start of the turn, of one syllable. */
  add(timeSec: number): void {
    // Two onsets closer than a 32nd note are one syllable detected twice.
    const minGap = 60 / this.beat.bpm / (GRID_SUBDIVISION * 2);
    const last = this.onsets[this.onsets.length - 1];
    if (last !== undefined && timeSec - last < minGap) return;
    this.onsets.push(timeSec);
  }

  get onsetCount(): number {
    return this.onsets.length;
  }

  /** Tightness of the most recent onset, for a live meter. 0-1, 1 is dead on. */
  lastTightness(): number {
    const last = this.onsets[this.onsets.length - 1];
    if (last === undefined) return 0;
    const stepSec = 60 / this.beat.bpm / GRID_SUBDIVISION;
    return Math.max(0, 1 - gridErrorSeconds(last, this.beat) / (stepSec / 2));
  }

  result(): FlowResult {
    const total = this.onsets.length;
    if (total === 0) {
      return { score: 0, onBeat: 0, total: 0, bars: 0, coverage: 0, accuracy: 0 };
    }

    const stepSec = 60 / this.beat.bpm / GRID_SUBDIVISION;
    const tightWindow = stepSec * TIGHT_FRACTION;

    let onBeat = 0;
    let tightnessSum = 0;
    for (const onset of this.onsets) {
      const error = gridErrorSeconds(onset, this.beat);
      if (error <= tightWindow) onBeat += 1;
      tightnessSum += Math.max(0, 1 - error / (stepSec / 2));
    }
    const accuracy = tightnessSum / total;

    // Rapping for six seconds of a sixty second turn should not score the same
    // as rapping for all of it, however tight those six seconds were.
    const first = this.onsets[0];
    const last = this.onsets[total - 1];
    const coverage = Math.min(1, (last - first) / Math.max(this.durationSec, 1));

    const barSec = (60 / this.beat.bpm) * 4;
    const bars = Math.max(0, Math.round(((last - first) / barSec) * 10) / 10);

    // Accuracy is the point, but a turn you did not fill is not a full turn.
    // Coverage is a multiplier rather than a term so it cannot be traded away.
    const score = Math.round(accuracy * 100 * (0.4 + 0.6 * coverage));

    return { score, onBeat, total, bars, coverage, accuracy };
  }

  reset(): void {
    this.onsets = [];
  }
}

// The beats we ship. Knowing the tempo up front is what makes any of this
// work, so a beat without a measured BPM does not belong in the list.
export const BEATS: Beat[] = [
  { slug: 'boom-bap-90', title: 'Boom Bap', bpm: 90, offsetSec: 0 },
  { slug: 'trap-140', title: 'Trap', bpm: 140, offsetSec: 0 },
  { slug: 'drill-142', title: 'Drill', bpm: 142, offsetSec: 0 },
  { slug: 'lo-fi-75', title: 'Lo-Fi', bpm: 75, offsetSec: 0 },
];

export function beatBySlug(slug: string): Beat {
  return BEATS.find((b) => b.slug === slug) ?? BEATS[0];
}

// A test seam, the same one the rep counter uses: the browser tests drive this
// directly rather than trying to rap into a headless Chrome.
declare global {
  // eslint-disable-next-line no-var
  var __trapChatFlowScorer:
    | { FlowScorer: typeof FlowScorer; BEATS: typeof BEATS; gridErrorSeconds: typeof gridErrorSeconds }
    | undefined;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__trapChatFlowScorer = { FlowScorer, BEATS, gridErrorSeconds };
}
