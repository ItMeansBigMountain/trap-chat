// Trap Chat — Ranked Match
// A timed 1v1. Your camera counts your reps on device, the count is relayed to
// your opponent as it changes, and the score is submitted when time runs out.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useApp } from '../context/AppContext';
import api from '../services/api';
import call, { videoSupported } from '../services/webrtc';
import poseTracker, { TrackerState } from '../services/poseTracker';
import { EXERCISES } from '../services/repCounter';

const isWeb = Platform.OS === 'web';

function Camera({ stream, onReady }: { stream: MediaStream | null; onReady: (el: HTMLVideoElement) => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) onReady(el);
  }, [stream, onReady]);
  if (!isWeb) return null;
  return React.createElement('video', {
    ref,
    autoPlay: true,
    playsInline: true,
    muted: true,
    style: { width: '100%', height: '100%', objectFit: 'cover', background: '#000', display: 'block', transform: 'scaleX(-1)' },
  });
}

export function RankedMatchScreen() {
  const { state, forfeit, submitResult } = useApp();
  const match = state.currentMatch;
  const slug = match?.game?.slug ?? '';
  const spec = EXERCISES[slug];
  const duration = match?.game?.default_time_sec || 60;

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [reps, setReps] = useState(0);
  const [stage, setStage] = useState<'up' | 'down'>('up');
  const [hint, setHint] = useState<string | undefined>();
  const [tracker, setTracker] = useState<TrackerState>('idle');
  const [trackerDetail, setTrackerDetail] = useState<string | undefined>();
  const [opponentReps, setOpponentReps] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(duration);
  const [finished, setFinished] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const startedRef = useRef(false);

  // Camera. Ranked play needs your own feed even when the opponent's is not
  // through yet, because the counting runs on it.
  useEffect(() => {
    if (!match || !videoSupported()) return;
    let cancelled = false;
    call.start(match.id, {
      onLocalStream: (s) => !cancelled && setLocalStream(s),
      onState: (_s, detail) => !cancelled && detail && setTrackerDetail(detail),
    });
    return () => {
      cancelled = true;
      call.stop();
    };
  }, [match?.id]);

  const attachTracker = useCallback(
    (element: HTMLVideoElement) => {
      if (startedRef.current || !spec || !match) return;
      startedRef.current = true;
      poseTracker.start(element, spec, {
        onState: (s, detail) => {
          setTracker(s);
          if (detail) setTrackerDetail(detail);
        },
        onRep: (update) => {
          setReps(update.count);
          setStage(update.stage);
          setHint(update.hint);
          // Relay only on change, so the socket is not flooded per frame.
          if (update.counted) {
            api.sendGameAction(match.id, 'rep', { count: update.count });
          }
        },
      });
    },
    [spec, match?.id],
  );

  useEffect(() => () => poseTracker.stop(), []);

  // Opponent's running count.
  useEffect(() => {
    const off = api.onGameAction(({ action, payload }) => {
      if (action === 'rep' && typeof payload?.count === 'number') {
        setOpponentReps(payload.count as number);
      }
    });
    const offFinished = api.onMatchFinished((data) => {
      const result = (data as { outcome?: string }).outcome;
      setOutcome(result === 'stalemate' ? 'Stalemate: your opponent disconnected.' : 'Match finished.');
      setFinished(true);
    });
    return () => {
      off();
      offFinished();
    };
  }, []);

  // Countdown, then submit once.
  useEffect(() => {
    if (finished || !match) return;
    if (secondsLeft <= 0) {
      setFinished(true);
      poseTracker.stop();
      submitResult(match.id, { score: reps, rep_count: reps, duration_sec: duration })
        .then(() => setOutcome(`Time. You scored ${reps}.`))
        .catch(() => setOutcome('Time, but the score could not be saved.'));
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft, finished, match?.id, reps, duration, submitResult]);

  if (!match) return null;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.game}>{spec?.label ?? match.game?.name ?? 'Ranked match'}</Text>
          <Text style={styles.sub}>Ranked 1v1</Text>
        </View>
        <Text style={[styles.clock, secondsLeft <= 10 && styles.clockLow]}>{secondsLeft}s</Text>
      </View>

      <View style={styles.scores}>
        <View style={styles.scoreBox}>
          <Text style={styles.scoreLabel}>YOU</Text>
          <Text style={styles.score}>{reps}</Text>
        </View>
        <View style={styles.scoreBox}>
          <Text style={styles.scoreLabel}>OPPONENT</Text>
          <Text style={styles.score}>{opponentReps}</Text>
        </View>
      </View>

      <View style={styles.cameraWrap}>
        <Camera stream={localStream} onReady={attachTracker} />
        {tracker === 'loading' && (
          <View style={styles.overlay}>
            <ActivityIndicator color="#CCFF00" />
            <Text style={styles.overlayText}>Loading the rep counter…</Text>
          </View>
        )}
        {tracker === 'failed' && (
          <View style={styles.overlay}>
            <Text style={styles.overlayText}>{trackerDetail ?? 'Rep counting unavailable'}</Text>
          </View>
        )}
        {tracker === 'running' && (
          <View style={styles.stageBadge}>
            <Text style={styles.stageText}>{stage === 'down' ? 'DOWN' : 'UP'}</Text>
          </View>
        )}
      </View>

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {finished ? (
        <View style={styles.done}>
          <Text style={styles.doneText}>{outcome ?? 'Match finished.'}</Text>
          <TouchableOpacity style={styles.leave} onPress={forfeit}>
            <Text style={styles.leaveText}>Back to lobby</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.forfeit} onPress={forfeit}>
          <Text style={styles.forfeitText}>Forfeit</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000', paddingTop: 48, paddingHorizontal: 18, paddingBottom: 18, alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', width: '100%', maxWidth: 460, marginBottom: 12 },
  game: { color: '#fff', fontSize: 21, fontWeight: '800' },
  sub: { color: '#a1a1a1', fontSize: 12, marginTop: 2 },
  clock: { color: '#CCFF00', fontSize: 26, fontWeight: '900' },
  clockLow: { color: '#CCFF00' },
  scores: { flexDirection: 'row', gap: 12, width: '100%', maxWidth: 460, marginBottom: 12 },
  scoreBox: { flex: 1, backgroundColor: '#121212', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  scoreLabel: { color: '#a1a1a1', fontSize: 10, letterSpacing: 1.4, fontWeight: '700' },
  score: { color: '#fff', fontSize: 34, fontWeight: '900', marginTop: 2 },
  cameraWrap: { flex: 1, width: '100%', maxWidth: 460, backgroundColor: '#000', borderRadius: 8, overflow: 'hidden', position: 'relative' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  overlayText: { color: '#a1a1a1', fontSize: 13, textAlign: 'center' },
  stageBadge: { position: 'absolute', left: 12, bottom: 12, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(17,20,28,0.85)' },
  stageText: { color: '#CCFF00', fontWeight: '900', fontSize: 12, letterSpacing: 1.5 },
  hint: { color: '#f59e0b', fontSize: 12, marginTop: 10, textAlign: 'center' },
  done: { width: '100%', maxWidth: 460, marginTop: 14, alignItems: 'center' },
  doneText: { color: '#fff', fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  leave: { backgroundColor: '#CCFF00', borderRadius: 8, paddingVertical: 15, paddingHorizontal: 40 },
  leaveText: { color: '#000', fontWeight: '800' },
  forfeit: { width: '100%', maxWidth: 460, marginTop: 14, backgroundColor: '#1f1f1f', borderRadius: 8, paddingVertical: 15, alignItems: 'center' },
  forfeitText: { color: '#CCFF00', fontWeight: '800' },
});
