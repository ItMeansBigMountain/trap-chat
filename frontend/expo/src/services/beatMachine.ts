// Trap Chat — Beat Machine
// Synthesises the beat instead of streaming one.
//
// Two reasons, and the second is the important one. Media cannot be loaded
// from a CDN on this deployment, so a beat file would have to ship in the
// bundle. And scoring someone against a recording means detecting where its
// beats are, which is the step every other app in this space gets wrong.
// A beat we schedule ourselves has a grid that is exact by construction: we
// know when every sixteenth falls because we put it there.
//
// Everything is scheduled ahead on the AudioContext clock rather than from a
// timer. setInterval drifts by tens of milliseconds under load, which is the
// same order as the thing being measured.

import { Beat } from './flowScorer';

// How far ahead to schedule, and how often to top it up. The lookahead has to
// survive a slow frame; the interval has to be well inside it.
const LOOKAHEAD_SEC = 0.25;
const SCHEDULE_MS = 60;

type Voice = 'kick' | 'snare' | 'hat';

// One bar of sixteenths. A plain boom-bap skeleton: kick on 1 and the "and" of
// 3, snare on 2 and 4, hats on every eighth.
const PATTERN: Record<Voice, number[]> = {
  kick: [0, 6, 10],
  snare: [4, 12],
  hat: [0, 2, 4, 6, 8, 10, 12, 14],
};

export class BeatMachine {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextStep = 0;
  private nextStepTime = 0;
  private startTime = 0;

  constructor(private readonly beat: Beat) {}

  /** Seconds since the first downbeat. The scorer's grid is relative to this,
   *  so onsets and the beat are read off one clock. */
  now(): number {
    if (!this.ctx) return 0;
    return this.ctx.currentTime - this.startTime;
  }

  get running(): boolean {
    return this.ctx !== null;
  }

  async start(): Promise<void> {
    const Ctor: typeof AudioContext | undefined =
      (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio is not available in this browser');
    this.ctx = new Ctor();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.nextStep = 0;
    // A beat that starts in the same instant it is scheduled clips its own
    // first hit, so give the graph a moment.
    this.startTime = this.ctx.currentTime + 0.08;
    this.nextStepTime = this.startTime;
    this.timer = setInterval(this.schedule, SCHEDULE_MS);
    this.schedule();
  }

  private get stepSec(): number {
    return 60 / this.beat.bpm / 4;
  }

  private schedule = (): void => {
    if (!this.ctx) return;
    while (this.nextStepTime < this.ctx.currentTime + LOOKAHEAD_SEC) {
      const step = this.nextStep % 16;
      if (PATTERN.kick.includes(step)) this.hit('kick', this.nextStepTime);
      if (PATTERN.snare.includes(step)) this.hit('snare', this.nextStepTime);
      if (PATTERN.hat.includes(step)) this.hit('hat', this.nextStepTime);
      this.nextStepTime += this.stepSec;
      this.nextStep += 1;
    }
  };

  private hit(voice: Voice, at: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    if (voice === 'kick') {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(150, at);
      osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
      gain.gain.setValueAtTime(0.9, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
      osc.connect(gain);
      osc.start(at);
      osc.stop(at + 0.24);
      return;
    }

    // Snare and hat are both filtered noise, so they share a buffer.
    const length = Math.floor(ctx.sampleRate * (voice === 'snare' ? 0.2 : 0.05));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = voice === 'snare' ? 1200 : 7000;
    gain.gain.setValueAtTime(voice === 'snare' ? 0.5 : 0.16, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + (voice === 'snare' ? 0.2 : 0.05));
    noise.connect(filter);
    filter.connect(gain);
    noise.start(at);
    noise.stop(at + 0.22);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    try {
      void this.ctx?.close();
    } catch {
      // Already closed.
    }
    this.ctx = null;
  }
}
