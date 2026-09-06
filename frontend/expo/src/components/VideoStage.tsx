// Trap Chat — Video Stage
// Remote face fills the frame, your own camera sits in the corner. Media is
// peer to peer; the backend only relays the handshake.

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { CallState } from '../services/webrtc';

// react-native-web renders to the DOM, so a real <video> element is the right
// tool here. Guarded so native never tries to render one.
const isWeb = Platform.OS === 'web';

function Stream({
  stream,
  muted,
  style,
}: {
  stream: MediaStream | null;
  muted: boolean;
  style: React.CSSProperties;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
    }
  }, [stream]);
  if (!isWeb) return null;
  return React.createElement('video', {
    ref,
    autoPlay: true,
    playsInline: true,
    muted,
    style,
  });
}

export function VideoStage({
  localStream,
  remoteStream,
  state,
  detail,
  muted,
  cameraOff,
  onToggleMute,
  onToggleCamera,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  state: CallState;
  detail?: string;
  muted: boolean;
  cameraOff: boolean;
  onToggleMute: () => void;
  onToggleCamera: () => void;
}) {
  return (
    <View style={styles.stage}>
      {remoteStream ? (
        <Stream
          stream={remoteStream}
          muted={false}
          style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000', display: 'block' }}
        />
      ) : (
        <View style={styles.waiting}>
          {state === 'failed' ? (
            <>
              <Text style={styles.waitIcon}>📵</Text>
              <Text style={styles.waitText}>{detail ?? 'Video unavailable'}</Text>
            </>
          ) : (
            <>
              <ActivityIndicator color="#818cf8" />
              <Text style={styles.waitText}>
                {state === 'requesting-media'
                  ? 'Allow camera and microphone'
                  : 'Connecting video…'}
              </Text>
            </>
          )}
        </View>
      )}

      {/* YOUR OWN CAMERA */}
      {localStream && (
        <View style={styles.selfWrap}>
          <Stream
            stream={localStream}
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', background: '#000', display: 'block', transform: 'scaleX(-1)' }}
          />
        </View>
      )}

      {/* MIC AND CAMERA TOGGLES */}
      <View style={styles.controls}>
        <TouchableOpacity onPress={onToggleMute} style={[styles.pill, muted && styles.pillOff]}>
          <Text style={styles.pillText}>{muted ? 'Unmute' : 'Mute'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onToggleCamera} style={[styles.pill, cameraOff && styles.pillOff]}>
          <Text style={styles.pillText}>{cameraOff ? 'Camera on' : 'Camera off'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#000', borderRadius: 16, overflow: 'hidden', position: 'relative' },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  waitIcon: { fontSize: 34 },
  waitText: { color: '#9ca3af', fontSize: 13, textAlign: 'center' },
  selfWrap: {
    position: 'absolute',
    right: 12,
    top: 12,
    width: 88,
    height: 118,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1f2430',
    backgroundColor: '#000',
  },
  controls: { position: 'absolute', bottom: 12, left: 12, flexDirection: 'row', gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(17,20,28,0.85)' },
  pillOff: { backgroundColor: '#7f1d1d' },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
