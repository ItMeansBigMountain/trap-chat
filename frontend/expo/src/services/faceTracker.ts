// Trap Chat — Face Tracking
// Runs MediaPipe Face Landmarker on the local camera and feeds the symmetry
// scorer. Detection happens entirely in the browser: no frames leave the
// device, which matters more here than anywhere else in the app.

import { Platform } from 'react-native';
import { FacePoint, FaceRun } from './faceScorer';

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const VISION_MODULE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs';

export type FaceTrackerState = 'idle' | 'loading' | 'running' | 'failed';

export interface FaceHandlers {
  onScore?: (score: number, live: number) => void;
  onState?: (state: FaceTrackerState, detail?: string) => void;
  /** The landmarks behind that score, for drawing over the camera. Given out
   *  per frame rather than stored, because they are only ever wanted live. */
  onLandmarks?: (points: FacePoint[]) => void;
}

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

export function faceSupported(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

export class FaceTracker {
  private landmarker: any = null;
  private raf: number | null = null;
  private video: HTMLVideoElement | null = null;
  private run: FaceRun | null = null;
  private handlers: FaceHandlers = {};
  private running = false;

  get score(): number {
    return this.run?.result() ?? 0;
  }

  get samples(): number {
    return this.run?.count ?? 0;
  }

  async start(video: HTMLVideoElement, handlers: FaceHandlers): Promise<void> {
    if (!faceSupported()) {
      handlers.onState?.('failed', 'This needs a browser with a camera.');
      return;
    }
    this.stop();
    this.video = video;
    this.run = new FaceRun();
    this.handlers = handlers;
    handlers.onState?.('loading');

    try {
      const vision: any = await loadVision();
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
      this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        // A low-confidence face is a wrong midline, and a wrong midline makes
        // every symmetry measurement meaningless.
        minFaceDetectionConfidence: 0.6,
        minFacePresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
    } catch {
      handlers.onState?.('failed', 'Could not load the face model.');
      return;
    }

    this.running = true;
    handlers.onState?.('running');
    this.loop();
  }

  private loop = (): void => {
    if (!this.running || !this.video || !this.landmarker || !this.run) return;
    const video = this.video;
    if (video.readyState >= 2 && video.videoWidth > 0) {
      try {
        const result = this.landmarker.detectForVideo(video, performance.now());
        const points: FacePoint[] | undefined = result?.faceLandmarks?.[0];
        if (points?.length) {
          const live = this.run.add(points);
          this.handlers.onScore?.(this.run.result(), live.score);
          this.handlers.onLandmarks?.(points);
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
      // Already closed.
    }
    this.landmarker = null;
    this.video = null;
  }
}

const faceTracker = new FaceTracker();
export default faceTracker;
