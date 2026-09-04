// Trap Chat — MediaPipe FaceMesh Service
// Handles facial symmetry scoring

import { FaceLandmarker, FilesetResolver, FaceLandmarkerResult } from '@mediapipe/tasks-vision';
import { FaceDetectionResult, FaceLandmark, SymmetryScore } from '../types';

export class MediaPipeFaceService {
  private faceLandmarker: FaceLandmarker | null = null;
  private runningMode: 'VIDEO' | 'IMAGE' = 'VIDEO';
  private onResultsCallback: ((result: FaceDetectionResult) => void) | null = null;

  // Key landmark indices for symmetry (468 face landmarks)
  private readonly LEFT_EYE = 33;      // Left eye center
  private readonly RIGHT_EYE = 263;    // Right eye center
  private readonly NOSE_TIP = 1;       // Nose tip
  private readonly LEFT_EAR = 234;     // Left ear
  private readonly RIGHT_EAR = 454;    // Right ear
  private readonly LEFT_CHEEK = 117;   // Left cheek
  private readonly RIGHT_CHEEK = 346;  // Right cheek
  private readonly LEFT_JAW = 172;     // Left jaw
  private readonly RIGHT_JAW = 397;    // Right jaw
  private readonly CHIN = 152;         // Chin
  private readonly FOREHEAD = 10;      // Forehead center

  async initialize(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );

    this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: this.runningMode,
      numFaces: 1,
      minFaceDetectionConfidence: 0.7,
      minFacePresenceConfidence: 0.7,
      minTrackingConfidence: 0.7,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });

    console.log('[MediaPipe Face] Initialized');
  }

  setOnResults(callback: (result: FaceDetectionResult) => void): void {
    this.onResultsCallback = callback;
  }

  detectForVideo(videoElement: HTMLVideoElement, timestamp: number): void {
    if (!this.faceLandmarker || !videoElement) return;

    try {
      const result = this.faceLandmarker.detectForVideo(videoElement, timestamp);
      this.processResult(result, timestamp);
    } catch (error) {
      console.error('[MediaPipe Face] Detection error:', error);
    }
  }

  private processResult(result: FaceLandmarkerResult, timestamp: number): void {
    if (result.faceLandmarks && result.faceLandmarks.length > 0) {
      const landmarks = result.faceLandmarks[0];
      
      const faceResult: FaceDetectionResult = {
        landmarks: landmarks.map(lm => ({
          x: lm.x,
          y: lm.y,
          z: lm.z,
        })),
        timestamp,
      };

      this.onResultsCallback?.(faceResult);
    }
  }

  calculateSymmetry(landmarks: FaceLandmark[]): SymmetryScore {
    if (landmarks.length < 468) {
      return { score: 0, left_eye: { x: 0, y: 0 }, right_eye: { x: 0, y: 0 }, nose: { x: 0, y: 0 }, left_ear: { x: 0, y: 0 }, right_ear: { x: 0, y: 0 } };
    }

    // Get key points
    const leftEye = landmarks[this.LEFT_EYE];
    const rightEye = landmarks[this.RIGHT_EYE];
    const nose = landmarks[this.NOSE_TIP];
    const leftEar = landmarks[this.LEFT_EAR];
    const rightEar = landmarks[this.RIGHT_EAR];
    const leftCheek = landmarks[this.LEFT_CHEEK];
    const rightCheek = landmarks[this.RIGHT_CHEEK];
    const leftJaw = landmarks[this.LEFT_JAW];
    const rightJaw = landmarks[this.RIGHT_JAW];
    const chin = landmarks[this.CHIN];
    const forehead = landmarks[this.FOREHEAD];

    // Calculate face center line (nose to forehead to chin)
    const faceCenterX = (nose.x + forehead.x + chin.x) / 3;

    // Compute symmetry for paired landmarks
    const pairs = [
      { left: leftEye, right: rightEye, weight: 0.25 },
      { left: leftEar, right: rightEar, weight: 0.20 },
      { left: leftCheek, right: rightCheek, weight: 0.20 },
      { left: leftJaw, right: rightJaw, weight: 0.20 },
    ];

    let totalSymmetry = 0;
    let totalWeight = 0;

    for (const { left, right, weight } of pairs) {
      // Distance from center line
      const leftDist = Math.abs(left.x - faceCenterX);
      const rightDist = Math.abs(right.x - faceCenterX);
      
      // Symmetry ratio (1 = perfect, 0 = completely asymmetric)
      const maxDist = Math.max(leftDist, rightDist);
      const minDist = Math.min(leftDist, rightDist);
      const pairSymmetry = maxDist > 0 ? minDist / maxDist : 1;
      
      totalSymmetry += pairSymmetry * weight;
      totalWeight += weight;
    }

    // Also check vertical alignment of eyes
    const eyeVerticalDiff = Math.abs(leftEye.y - rightEye.y);
    const eyeVerticalSymmetry = Math.max(0, 1 - eyeVerticalDiff * 10); // Scale factor
    totalSymmetry += eyeVerticalSymmetry * 0.15;
    totalWeight += 0.15;

    const finalScore = Math.round((totalSymmetry / totalWeight) * 100);

    return {
      score: Math.max(0, Math.min(100, finalScore)),
      left_eye: { x: leftEye.x, y: leftEye.y },
      right_eye: { x: rightEye.x, y: rightEye.y },
      nose: { x: nose.x, y: nose.y },
      left_ear: { x: leftEar.x, y: leftEar.y },
      right_ear: { x: rightEar.x, y: rightEar.y },
    };
  }

  dispose(): void {
    this.faceLandmarker?.close();
    this.faceLandmarker = null;
  }
}

export const faceService = new MediaPipeFaceService();
export default faceService;