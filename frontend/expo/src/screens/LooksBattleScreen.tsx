// Trap Chat — Looks Battle
// Both faces on camera for thirty seconds, then the room decides.
//
// There is nothing here for a machine to measure. Push-ups have a rep count
// and a rap has a beat to be on or off; a face has neither, and any score an
// algorithm produced would be a made-up number wearing a lab coat. So this
// game is the vote, and the camera is only how you make your case.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useApp } from '../context/AppContext';
import call, { CallState, videoSupported } from '../services/webrtc';
import api from '../services/api';
import { VideoStage } from '../components/VideoStage';
import { VotePanel } from '../components/VotePanel';
import { useAccent } from '../hooks/useAccent';
import { T } from '../theme';

const SHOWCASE_SECONDS = 30;

export function LooksBattleScreen() {
  const { state, leaveMatch } = useApp();
  const { accent, ink } = useAccent();
  const match = state.currentMatch;

  const [phase, setPhase] = useState<'showcase' | 'voting'>('showcase');
  const [left, setLeft] = useState(SHOWCASE_SECONDS);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callState, setCallState] = useState<CallState>('idle');
  const [callDetail, setCallDetail] = useState<string | undefined>();
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const started = useRef(false);

  const me =
    state.auth.status === 'authenticated'
      ? state.auth.user.username
      : state.auth.status === 'guest'
      ? state.auth.session.display_name
      : 'You';

  useEffect(() => {
    if (!match || !videoSupported() || started.current) return;
    started.current = true;
    let cancelled = false;
    call.start(match.id, {
      onLocalStream: (stream) => !cancelled && setLocalStream(stream),
      onRemoteStream: (stream) => !cancelled && setRemoteStream(stream),
      onState: (next, detail) => {
        if (cancelled) return;
        setCallState(next);
        setCallDetail(detail);
      },
    });
    return () => {
      cancelled = true;
      call.stop();
    };
  }, [match?.id]);

  // The peer already in the room makes the offer, so both sides never offer
  // at once and collide.
  useEffect(() => {
    if (!match) return;
    return api.onPlayerJoined(() => {
      if (videoSupported() && call.active) call.makeOffer();
    });
  }, [match?.id]);

  useEffect(() => {
    if (phase !== 'showcase') return;
    if (left <= 0) {
      setPhase('voting');
      return;
    }
    const tick = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(tick);
  }, [phase, left]);

  const endShowcase = useCallback(() => setLeft(0), []);

  if (!match) {
    return (
      <View style={styles.centre}>
        <Text style={styles.lead}>Leaving the battle…</Text>
      </View>
    );
  }

  if (phase === 'showcase') {
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={[styles.clock, { color: accent }]}>{left}s</Text>
          <Text style={styles.lead}>Look into the camera. The room votes next.</Text>
        </View>

        <View style={styles.stage}>
          {videoSupported() ? (
            <VideoStage
              localStream={localStream}
              remoteStream={remoteStream}
              state={callState}
              detail={callDetail}
              muted={muted}
              cameraOff={cameraOff}
              onToggleMute={() => {
                const next = !muted;
                setMuted(next);
                call.setMuted(next);
              }}
              onToggleCamera={() => {
                const next = !cameraOff;
                setCameraOff(next);
                call.setCameraOff(next);
              }}
            />
          ) : (
            <View style={styles.centre}>
              <Text style={styles.lead}>This browser has no camera, so there is nothing to judge.</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.cta, { backgroundColor: accent }]}
            onPress={endShowcase}
          >
            <Text style={[styles.ctaText, { color: ink }]}>Go to the vote</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quiet} onPress={leaveMatch}>
            <Text style={styles.quietText}>Forfeit</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>The room decides</Text>
      <Text style={styles.lead}>
        Nothing here is measurable, so nothing pretends to be. The vote is the
        whole result. You cannot vote for yourself.
      </Text>
      <VotePanel matchId={match.id} me={me} onLeave={leaveMatch} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  content: { padding: 20, paddingBottom: 40 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 26 },
  header: { paddingTop: 12, paddingHorizontal: 20, alignItems: 'center' },
  clock: { fontSize: 44, fontWeight: '900' },
  h1: { color: T.text, fontSize: 26, fontWeight: '900' },
  lead: { color: T.textDim, fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 14, textAlign: 'center' },
  stage: { flex: 1, marginHorizontal: 16, marginBottom: 12 },
  footer: { paddingHorizontal: 20, paddingBottom: 22, alignItems: 'center' },
  cta: { paddingVertical: 14, paddingHorizontal: 40, borderRadius: T.radius },
  ctaText: { fontWeight: '900', fontSize: 16 },
  quiet: { marginTop: 12, paddingVertical: 10, alignItems: 'center' },
  quietText: { color: T.textDim, fontWeight: '700', fontSize: 13 },
});
