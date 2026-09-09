// Trap Chat — Video Grid
//
// Everybody in the room, as tiles. This replaces a stage that could only ever
// show one other person: the remote face filled the frame and your own camera
// sat in the corner, so a room of five showed you one stranger and no sign
// that the other three existed.
//
// Two rules, and they are the whole design:
//
//   Two per row. Asked for directly, and it is also the only column count
//   that works on a phone — three across a 390pt screen gives each face about
//   120pt, which is too small to read an expression in.
//
//   A tile per person, camera or no camera. Turning your camera off should
//   remove your face, not remove you. A room where people vanish when they go
//   off camera cannot tell you who you are talking to, which is the thing a
//   group call is for.
//
// Media is peer to peer; the backend only relays the handshake.

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { CallState, PeerView } from '../services/webrtc';
import { T } from '../theme';

// react-native-web renders to the DOM, so a real <video> element is the right
// tool here. Guarded so native never tries to render one.
const isWeb = Platform.OS === 'web';

const COLUMNS = 2;
const GAP = 6;

function Stream({
  stream,
  muted,
  mirrored,
}: {
  stream: MediaStream;
  muted: boolean;
  mirrored?: boolean;
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
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      background: '#000',
      display: 'block',
      // Your own camera is a mirror, because that is what you expect of your
      // own reflection. Everybody else is not, because that is what they
      // actually look like.
      transform: mirrored ? 'scaleX(-1)' : undefined,
    },
  });
}

/** Whether there is a picture to show, as opposed to a track that is off. */
function hasVideo(stream: MediaStream | null): boolean {
  if (!stream) return false;
  return stream.getVideoTracks().some((track) => track.enabled && track.readyState === 'live');
}

/** Two letters is enough to tell people apart and always fits the tile. */
function initials(name: string | null): string {
  const cleaned = (name ?? '').replace(/#.*$/, '').trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function Tile({
  name,
  stream,
  muted,
  mirrored,
  label,
  waiting,
}: {
  name: string | null;
  stream: MediaStream | null;
  muted: boolean;
  mirrored?: boolean;
  /** Shown under the name: "You", or why there is no picture. */
  label?: string;
  waiting?: boolean;
}) {
  const showing = hasVideo(stream);
  return (
    <View style={styles.tile} accessibilityLabel={`${name ?? 'Someone'} tile`}>
      {showing && stream ? (
        <Stream stream={stream} muted={muted} mirrored={mirrored} />
      ) : (
        <View style={styles.placeholder}>
          {waiting ? (
            <ActivityIndicator color={T.textDim} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(name)}</Text>
            </View>
          )}
          {label ? <Text style={styles.placeholderText}>{label}</Text> : null}
        </View>
      )}
      <View style={styles.nameplate} pointerEvents="none">
        <Text style={styles.nameplateText} numberOfLines={1}>
          {name ?? 'Someone'}
        </Text>
      </View>
    </View>
  );
}

export function VideoGrid({
  localStream,
  peers,
  myName,
  state,
  detail,
  muted,
  cameraOff,
  onToggleMute,
  onToggleCamera,
}: {
  localStream: MediaStream | null;
  peers: PeerView[];
  myName: string | null;
  state: CallState;
  detail?: string;
  muted: boolean;
  cameraOff: boolean;
  onToggleMute: () => void;
  onToggleCamera: () => void;
}) {
  // You are always the first tile. Seeing yourself is how you know the camera
  // is working before you wonder why nobody is reacting to you.
  const tiles = [
    <Tile
      key="self"
      name={myName ? `${myName} (you)` : 'You'}
      stream={localStream}
      muted
      mirrored
      label={cameraOff ? 'Camera off' : localStream ? undefined : 'No camera'}
    />,
    ...peers.map((peer) => (
      <Tile
        key={peer.id}
        name={peer.name}
        stream={peer.stream}
        muted={false}
        waiting={!peer.connected && !peer.stream}
        label={
          peer.stream ? 'Camera off' : peer.connected ? 'No video' : 'Connecting…'
        }
      />
    )),
  ];

  return (
    <View style={styles.grid}>
      {state === 'failed' && peers.length === 0 ? (
        <View style={styles.notice}>
          <Text style={styles.noticeIcon}>📵</Text>
          <Text style={styles.noticeText}>{detail ?? 'Video unavailable'}</Text>
        </View>
      ) : (
        <View style={styles.rows}>
          {tiles.map((tile, index) => (
            <View
              key={index}
              style={[
                styles.cell,
                // The last tile of an odd count takes the full width rather
                // than leaving a hole beside it.
                tiles.length % COLUMNS === 1 && index === tiles.length - 1 && styles.cellWide,
              ]}
            >
              {tile}
            </View>
          ))}
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
  grid: { flex: 1, backgroundColor: '#000', borderRadius: 8, overflow: 'hidden', position: 'relative' },
  // Wrapping rather than a fixed row count: the tiles keep their share of the
  // width and the grid grows downwards, which is what "scaled as more people
  // join" has to mean when the width is a phone.
  rows: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start', padding: GAP / 2 },
  cell: { width: `${100 / COLUMNS}%`, aspectRatio: 3 / 4, padding: GAP / 2 },
  cellWide: { width: '100%', aspectRatio: 16 / 10 },
  tile: {
    flex: 1,
    backgroundColor: '#0d0d0d',
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: T.border,
  },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8 },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#22222a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: T.text, fontWeight: '900', fontSize: 19, letterSpacing: 0.5 },
  placeholderText: { color: T.textDim, fontSize: 11, textAlign: 'center' },
  nameplate: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    right: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  nameplateText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  notice: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  noticeIcon: { fontSize: 34 },
  noticeText: { color: T.textDim, fontSize: 13, textAlign: 'center' },
  controls: { position: 'absolute', bottom: 12, left: 12, flexDirection: 'row', gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(17,20,28,0.85)' },
  pillOff: { backgroundColor: '#7f1d1d' },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
