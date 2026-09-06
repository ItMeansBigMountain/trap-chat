// Trap Chat — Onset Detector
// Listens to the microphone and reports the moment each syllable starts.
//
// Syllables are what land on the grid, so this looks for sudden rises in
// energy rather than loudness itself: a rapper holding a word is loud without
// starting anything new. Spectral flux, the sum of positive changes across the
// spectrum between frames, is the standard measure for that and is cheap
// enough to run from an AnalyserNode every animation frame.
//
// The threshold adapts to a rolling median, because a phone in a bedroom and a
// phone in a car have completely different noise floors and a fixed threshold
// would either miss everything or fire constantly.

export type OnsetHandler = (timeSec: number) => void;

// Nothing below this is a syllable, however quiet the room is. Without a floor
// the adaptive threshold chases silence and reports breathing as bars.
const ABSOLUTE_FLOOR = 0.012;

// How far above the recent median a frame has to jump to count as an onset.
const SENSITIVITY = 1.7;

// Frames of flux kept for the running median.
const HISTORY = 43;

export class OnsetDetector {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private spectrum: Float32Array | null = null;
  private previous: Float32Array | null = null;
  private history: number[] = [];
  private raf: number | null = null;
  private startedAt = 0;
  private running = false;

  /** Latest flux relative to the threshold, for a live level meter. 0-1. */
  level = 0;

  constructor(private readonly onOnset: OnsetHandler) {}

  async start(stream: MediaStream): Promise<void> {
    const Ctor: typeof AudioContext | undefined =
      (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio is not available in this browser');

    this.ctx = new Ctor();
    // A context created before a gesture starts suspended, and a suspended
    // context produces silence rather than an error, which looks exactly like
    // a rapper who never said anything.
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0;  // smoothing hides the rises
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);

    this.spectrum = new Float32Array(this.analyser.frequencyBinCount);
    this.previous = new Float32Array(this.analyser.frequencyBinCount);
    this.history = [];
    this.startedAt = this.now();
    this.running = true;
    this.tick();
  }

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000;
  }

  private tick = (): void => {
    if (!this.running || !this.analyser || !this.spectrum || !this.previous) return;

    this.analyser.getFloatFrequencyData(this.spectrum as any);

    // Only rises count. A syllable ending is a fall, and counting both would
    // double every one of them.
    let flux = 0;
    for (let i = 0; i < this.spectrum.length; i += 1) {
      // Decibels, so normalise to 0-1 over the analyser's own range first.
      const current = Math.max(0, (this.spectrum[i] + 100) / 100);
      const before = this.previous[i];
      if (current > before) flux += current - before;
      this.previous[i] = current;
    }
    flux /= this.spectrum.length;

    this.history.push(flux);
    if (this.history.length > HISTORY) this.history.shift();

    const threshold = Math.max(ABSOLUTE_FLOOR, median(this.history) * SENSITIVITY);
    this.level = Math.min(1, flux / (threshold || 1));

    if (flux > threshold && this.history.length >= 8) {
      this.onOnset(this.now() - this.startedAt);
    }

    this.raf =
      typeof requestAnimationFrame !== 'undefined'
        ? requestAnimationFrame(this.tick)
        : (setTimeout(this.tick, 16) as unknown as number);
  };

  stop(): void {
    this.running = false;
    if (this.raf !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.raf);
    }
    this.raf = null;
    try {
      this.source?.disconnect();
      this.analyser?.disconnect();
      void this.ctx?.close();
    } catch {
      // Already torn down. Nothing to recover.
    }
    this.ctx = null;
    this.analyser = null;
    this.source = null;
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function micSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!((globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext)
  );
}
