// Trap Chat — MediaPipe Pose Detection Service
// Handles push-up and squat counting via MediaPipe Tasks Vision (Web)

import { PoseLandmarker, FilesetResolver, DrawingUtils, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { PoseDetectionResult, PoseLandmark, RepCounterState } from '../types';

type PoseLandmarkerCallback = (result: PoseLandmarkerResult, image: unknown, timestamp: number) => void;

export class MediaPipePoseService {
  private poseLandmarker: PoseLandmarker | null = null;
  private runningMode: 'VIDEO' | 'IMAGE' = 'VIDEO';
  private lastFrameTime = 0;
  private onResultsCallback: ((result: PoseDetectionResult) => void) | null = null;

  // Rep counting state
  private repState: RepCounterState = {
    count: 0,
    stage: 'up',
    last_rep_time: 0,
    angles: { left: 0, right: 0 },
    form_issues: [],
  };

  // Thresholds (same as Python version)
  private readonly ELBOW_UP_THRESHOLD = 160;
  private readonly ELBOW_DOWN_THRESHOLD = 85;
  private readonly SYMMETRY_TOLERANCE = 15;
  private readonly ALIGNMENT_TOLERANCE = 20;
  private readonly MIN_REP_TIME = 1.0;
  private readonly MAX_REP_TIME = 6.0;

  // Smoothing
  private angleHistoryLeft: number[] = [];
  private angleHistoryRight: number[] = [];
  private smoothingWindow = 5;

  // Landmark indices (MediaPipe 33 keypoints)
  private readonly L_SHOULDER = 11;
  private readonly R_SHOULDER = 12;
  private readonly L_ELBOW = 13;
  private readonly R_ELBOW = 14;
  private readonly L_WRIST = 15;
  private readonly R_WRIST = 16;
  private readonly L_HIP = 23;
  private readonly R_HIP = 24;
  private readonly L_KNEE = 25;
  private readonly R_KNEE = 26;
  private readonly L_ANKLE = 27;
  private readonly R_ANKLE = 28;

  async initialize(modelType: 'lite' | 'full' | 'heavy' = 'full'): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );

    const modelName = modelType === 'lite' ? 'pose_landmarker_lite.task' 
      : modelType === 'heavy' ? 'pose_landmarker_heavy.task'
      : 'pose_landmarker.task';

    this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${modelType}/float16/latest/${modelName}`,
        delegate: 'GPU',
      },
      runningMode: this.runningMode,
      numPoses: 1,
      minPoseDetectionConfidence: 0.7,
      minPosePresenceConfidence: 0.7,
      minTrackingConfidence: 0.7,
      outputSegmentationMasks: false,
    });

    console.log('[MediaPipe Pose] Initialized with', modelType, 'model');
  }

  setOnResults(callback: (result: PoseDetectionResult) => void): void {
    this.onResultsCallback = callback;
  }

  detectForVideo(videoElement: HTMLVideoElement, timestamp: number): void {
    if (!this.poseLandmarker || !videoElement) return;

    try {
      const result = this.poseLandmarker.detectForVideo(videoElement, timestamp);
      this.processResult(result, timestamp);
    } catch (error) {
      console.error('[MediaPipe Pose] Detection error:', error);
    }
  }

  private processResult(result: PoseLandmarkerResult, timestamp: number): void {
    if (result.landmarks && result.landmarks.length > 0) {
      const landmarks = result.landmarks[0];
      
      // Convert to our format
      const poseResult: PoseDetectionResult = {
        landmarks: landmarks.map(lm => ({
          x: lm.x,
          y: lm.y,
          z: lm.z,
          visibility: lm.visibility || 1.0,
        })),
        timestamp,
      };

      // Analyze form and count reps
      this.analyzeForm(poseResult.landmarks);
      
      // Call callback
      this.onResultsCallback?.(poseResult);
    }
  }

  private analyzeForm(landmarks: PoseLandmark[]): void {
    if (landmarks.length < 33) return;

    // Get key points
    const ls = landmarks[this.L_SHOULDER];
    const rs = landmarks[this.R_SHOULDER];
    const le = landmarks[this.L_ELBOW];
    const re = landmarks[this.R_ELBOW];
    const lw = landmarks[this.L_WRIST];
    const rw = landmarks[this.R_WRIST];
    const lh = landmarks[this.L_HIP];
    const rh = landmarks[this.R_HIP];
    const la = landmarks[this.L_ANKLE];
    const ra = landmarks[this.R_ANKLE];

    // Calculate elbow angles
    const elbowLeft = this.calculateAngle(ls, le, lw);
    const elbowRight = this.calculateAngle(rs, re, rw);

    // Smooth angles
    this.angleHistoryLeft.push(elbowLeft);
    this.angleHistoryRight.push(elbowRight);
    if (this.angleHistoryLeft.length > this.smoothingWindow) {
      this.angleHistoryLeft.shift();
      this.angleHistoryRight.shift();
    }
    const smoothLeft = this.angleHistoryLeft.reduce((a, b) => a + b, 0) / this.angleHistoryLeft.length;
    const smoothRight = this.angleHistoryRight.reduce((a, b) => a + b, 0) / this.angleHistoryRight.length;

    // Body alignment
    const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, z: (lh.z + rh.z) / 2 };
    const shoulderMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: (ls.z + rs.z) / 2 };
    const ankleMid = { x: (la.x + ra.x) / 2, y: (la.y + ra.y) / 2, z: (la.z + ra.z) / 2 };
    const bodyAlignment = this.calculateAngle(shoulderMid, hipMid, ankleMid);

    // Update state
    const avgElbow = (smoothLeft + smoothRight) / 2;
    const prevStage = this.repState.stage;

    if (avgElbow > this.ELBOW_UP_THRESHOLD) {
      this.repState.stage = 'up';
    } else if (avgElbow < this.ELBOW_DOWN_THRESHOLD) {
      this.repState.stage = 'down';
    } else {
      this.repState.stage = 'transition';
    }

    this.repState.angles = { left: smoothLeft, right: smoothRight };

    // Form checks
    const depthOk = avgElbow <= this.ELBOW_DOWN_THRESHOLD;
    const symmetryDiff = Math.abs(smoothLeft - smoothRight);
    const symmetryOk = symmetryDiff <= this.SYMMETRY_TOLERANCE;
    const alignmentOk = Math.abs(180 - bodyAlignment) <= this.ALIGNMENT_TOLERANCE;

    const issues: string[] = [];
    if (!depthOk && this.repState.stage === 'down') {
      issues.push('Go deeper - chest to floor');
    }
    if (!symmetryOk) {
      issues.push(`Uneven arms (${symmetryDiff.toFixed(0)}° diff)`);
    }
    if (!alignmentOk) {
      issues.push('Keep body straight');
    }
    this.repState.form_issues = issues;

    // Rep counting
    if (prevStage === 'down' && this.repState.stage === 'up') {
      const repTime = (Date.now() - this.repState.last_rep_time) / 1000;
      const tempoOk = repTime >= this.MIN_REP_TIME && repTime <= this.MAX_REP_TIME;
      
      if (!tempoOk) {
        if (repTime < this.MIN_REP_TIME) issues.push('Too fast - control descent');
        else issues.push('Too slow - maintain rhythm');
      }

      this.repState.count++;
      this.repState.last_rep_time = Date.now();
    }
  }

  private calculateAngle(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }): number {
    const ba = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
    const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
    const normBa = Math.sqrt(ba.x * ba.x + ba.y * ba.y + ba.z * ba.z);
    const normBc = Math.sqrt(bc.x * bc.x + bc.y * bc.y + bc.z * bc.z);
    const cosine = Math.max(-1, Math.min(1, dot / (normBa * normBc + 1e-6)));
    return (Math.acos(cosine) * 180) / Math.PI;
  }

  getRepState(): RepCounterState {
    return { ...this.repState };
  }

  reset(): void {
    this.repState = {
      count: 0,
      stage: 'up',
      last_rep_time: 0,
      angles: { left: 0, right: 0 },
      form_issues: [],
    };
    this.angleHistoryLeft = [];
    this.angleHistoryRight = [];
  }

  dispose(): void {
    this.poseLandmarker?.close();
    this.poseLandmarker = null;
  }
}

export const poseService = new MediaPipePoseService();
export default poseService;