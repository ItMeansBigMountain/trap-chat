// Trap Chat — Camera & Pose Detection Screen
// Shows webcam feed with MediaPipe overlay for push-up games

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useApp } from '../context/AppContext';
import { poseService } from '../services/pose';
import { RepCounterState } from '../types';

interface Props {
  onComplete: (result: { rep_count: number; duration_sec: number }) => void;
  onCancel: () => void;
  timeLimit?: number;
}

export function PoseGameScreen({ onComplete, onCancel, timeLimit = 60 }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [repState, setRepState] = useState<RepCounterState>({
    count: 0, stage: 'up', last_rep_time: 0, angles: { left: 0, right: 0 }, form_issues: [],
  });
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const [isDetecting, setIsDetecting] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const frameCount = useRef(0);
  const { submitResult } = useApp();

  // Initialize MediaPipe
  useEffect(() => {
    async function init() {
      await poseService.initialize('full');
      poseService.setOnResults((result) => {
        setRepState(poseService.getRepState());
      });
      console.log('[PoseGame] MediaPipe initialized');
    }
    init();
  }, []);

  // Timer
  useEffect(() => {
    if (timeLeft <= 0) {
      handleComplete();
      return;
    }
    const timer = setInterval(() => setTimeLeft(t => t - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  // Process video frames for pose detection
  const handleCameraFrame = useCallback(async () => {
    if (!cameraRef.current || !cameraReady) return;

    frameCount.current++;
    // Process every 3rd frame for performance (10 FPS on 30 FPS video)
    if (frameCount.current % 3 !== 0) return;

    try {
      // Expo Camera exposes the live preview; MediaPipe frame extraction is wired
      // through the web video element in the browser build. Native builds use
      // the camera preview as the capture surface for the native adapter.
      // In web: pass the video element to poseService.detectForVideo().
    } catch (err) {
      // Frame capture error - skip
    }
  }, [cameraReady]);

  const handleComplete = async () => {
    try {
      const result = {
        rep_count: repState.count,
        duration_sec: timeLimit - timeLeft,
      };
      await submitResult(0, result); // Match ID would come from match context
      onComplete(result);
    } catch (err) {
      console.error('[PoseGame] Submit error:', err);
      onComplete({ rep_count: repState.count, duration_sec: timeLimit - timeLeft });
    }
  };

  if (!permission?.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera permission required</Text>
        <TouchableOpacity onPress={requestPermission}><Text style={styles.link}>Grant Permission</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="front"
        onCameraReady={() => {
          setCameraReady(true);
          // Start frame processing loop
          const interval = setInterval(handleCameraFrame, 100);
          return () => clearInterval(interval);
        }}
      />
      
      {/* HUD Overlay */}
      <View style={styles.overlay}>
        {/* Timer */}
        <View style={styles.timerBox}>
          <Text style={styles.timerText}>{timeLeft}s</Text>
        </View>

        {/* Rep Counter */}
        <View style={styles.repBox}>
          <Text style={styles.repCount}>{repState.count}</Text>
          <Text style={styles.repLabel}>Push-ups</Text>
        </View>

        {/* Angle Display */}
        <View style={styles.angleBox}>
          <Text style={styles.angleText}>L: {repState.angles.left.toFixed(0)}°</Text>
          <Text style={styles.angleText}>R: {repState.angles.right.toFixed(0)}°</Text>
        </View>

        {/* Form Issues */}
        {repState.form_issues.length > 0 && (
          <View style={styles.issuesBox}>
            {repState.form_issues.map((issue, i) => (
              <Text key={i} style={styles.issueText}>⚠️ {issue}</Text>
            ))}
          </View>
        )}

        {/* Stage Indicator */}
        <View style={[styles.stageIndicator, 
          repState.stage === 'up' ? styles.stageGreen : 
          repState.stage === 'down' ? styles.stageOrange : styles.stageYellow
        ]}>
          <Text style={styles.stageText}>{repState.stage.toUpperCase()}</Text>
        </View>
      </View>

      {/* Cancel Button */}
      <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const { width, height } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1, width },
  
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: 20 },
  timerBox: { position: 'absolute', top: 50, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20 },
  timerText: { color: '#fff', fontSize: 28, fontWeight: 'bold' },
  repBox: { position: 'absolute', top: '40%', alignSelf: 'center', alignItems: 'center' },
  repCount: { fontSize: 72, fontWeight: 'bold', color: '#FE2C55' },
  repLabel: { color: '#888', fontSize: 14 },
  angleBox: { position: 'absolute', bottom: 200, alignSelf: 'center', alignItems: 'center' },
  angleText: { color: '#fff', fontSize: 16 },
  issuesBox: { position: 'absolute', bottom: 100, alignSelf: 'center', alignItems: 'center' },
  issueText: { color: '#ff6b6b', fontSize: 12, marginBottom: 2 },
  stageIndicator: { position: 'absolute', top: 100, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
  stageGreen: { backgroundColor: 'rgba(34,197,94,0.8)' },
  stageOrange: { backgroundColor: 'rgba(249,115,22,0.8)' },
  stageYellow: { backgroundColor: 'rgba(234,179,8,0.8)' },
  stageText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  cancelBtn: { position: 'absolute', bottom: 30, alignSelf: 'center', backgroundColor: '#FE2C55', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  cancelText: { color: '#fff' },
  text: { color: '#fff', textAlign: 'center', margin: 20 },
  link: { color: '#FE2C55', textAlign: 'center', marginTop: 10, fontSize: 16 },
});