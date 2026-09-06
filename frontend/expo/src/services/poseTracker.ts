// Trap Chat — Pose Tracking
// Runs MediaPipe pose detection on the local camera and feeds the rep counter.
// Detection happens entirely in the browser: no frames leave the device.

import { Platform } from 'react-native';
import { ExerciseSpec, Landmark, RepCounter, RepUpdate } from './repCounter';

// The model and wasm are fetched from Google's CDN on first use. They are a
// few megabytes, so the caller should show that something is loading.
const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export type TrackerState = 'idle' | 'loading' | 'running' | 'failed';

export interface TrackerHandlers {
  onRep?: (update: RepUpdate) => void;
  onState?: (state: TrackerState, detail?: string) => void;
}

const VISION_MODULE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs';

let visionPromise: Promise<any> | null = null;

/**
 * Import the vision bundle at runtime. The indirection through Function keeps
 * the specifier opaque to the bundler, which would otherwise try to inline a
 * module it cannot parse.
 */
function loadVision(): Promise<any> {
  if (!visionPromise) {
    const dynamicImport = new Function('url', 'return import(url)') as (u: string) => Promise<any>;
    visionPromise = dynamicImport(VISION_MODULE);
  }
  return visionPromise;
}

export function poseSupported(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

export class PoseTracker {
  private landmarker: any = null;
  private raf: number | null = null;
  private video: HTMLVideoElement | null = null;
  private counter: RepCounter | null = null;
  private handlers: TrackerHandlers = {};
  private running = false;

  get reps(): number {
    return this.counter?.reps ?? 0;
  }

  async start(video: HTMLVideoElement, spec: ExerciseSpec, handlers: TrackerHandlers): Promise<void> {
    if (!poseSupported()) {
      handlers.onState?.('failed', 'Rep counting needs a browser with a camera.');
      return;
    }
    this.stop();
    this.video = video;
    this.counter = new RepCounter(spec);
    this.handlers = handlers;
    handlers.onState?.('loading');

    try {
      // Loaded from the CDN at runtime rather than bundled. The package ships
      // a dynamic import that Metro cannot analyse, so bundling it fails the
      // whole web build; keeping it out also spares everyone who never opens a
      // ranked match the multi-megabyte download.
      const vision: any = await loadVision();
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
      this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
    } catch (err: any) {
      handlers.onState?.('failed', 'Could not load the pose model.');
      return;
    }

    this.running = true;
    handlers.onState?.('running');
    this.loop();
  }

  private loop = (): void => {
    if (!this.running || !this.video || !this.landmarker || !this.counter) return;
    const video = this.video;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      try {
        const result = this.landmarker.detectForVideo(video, performance.now());
        const landmarks: Landmark[] | undefined = result?.landmarks?.[0];
        if (landmarks?.length) {
          this.handlers.onRep?.(this.counter.update(landmarks));
        }
      } catch {
        // A dropped frame is not worth ending the match over.
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  stop(): void {
    this.running = false;
    if (this.raf != null) cancelAnimationFrame(this.raf);
    this.raf = null;
    try {
      this.landmarker?.close?.();
    } catch {
      /* already closed */
    }
    this.landmarker = null;
    this.video = null;
    this.counter = null;
  }
}

export const poseTracker = new PoseTracker();
export default poseTracker;
