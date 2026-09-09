// Trap Chat — Shadow Boxing
// A timed 1v1. Throw as many punches as you can; the camera counts them on
// device and every ten unbroken punches raises what the next one is worth.
//
// The score is not the punch count. Sustained output is the point, so a
// hundred punches thrown in one long combo beats a hundred thrown in bursts,
// and letting the combo lapse is the only thing that costs you.

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
import { MatchOutcome } from '../components/MatchOutcome';
import { useMatchClock, clearMatchClock } from '../hooks/useMatchClock';
import api from '../services/api';
import call, { PeerView, videoSupported } from '../services/webrtc';
import { VideoGrid } from '../components/VideoGrid';
import poseTracker, { TrackerState } from '../services/poseTracker';
import { PUNCHES_PER_MULTIPLIER } from '../services/punchCounter';
import { useAccent } from '../hooks/useAccent';
import { T } from '../theme';

const isWeb = Platform.OS === 'web';


export function ShadowBoxScreen() {
  const { state, forfeit, submitResult, findNextMatch, leaveMatch } = useApp();
  const { accent, ink } = useAccent();
  const match = state.currentMatch;
  const duration = match?.game?.default_time_sec || 60;

  const me =
    state.auth.status === 'authenticated'
      ? state.auth.user.username
      : state.auth.status === 'guest'
      ? state.auth.session.display_name
      : '';

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  // Your opponent, on screen rather than reduced to a number.
  const [peers, setPeers] = useState<PeerView[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [punches, setPunches] = useState(0);
  const [combo, setCombo] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [score, setScore] = useState(0);
  const [hint, setHint] = useState<string | undefined>();
  const [flash, setFlash] = useState(false);
  const [tracker, setTracker] = useState<TrackerState>('idle');
  const [trackerDetail, setTrackerDetail] = useState<string | undefined>();
  const [opponentScore, setOpponentScore] = useState(0);
  // Counted from a deadline, so navigating away and back does not restart it.
  const secondsLeft = useMatchClock(match?.id, duration);
  const [finished, setFinished] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const startedRef = useRef(false);
  const scoreRef = useRef(0);

  useEffect(() => {
    if (!match || !videoSupported()) return;
    let cancelled = false;
    call.start(match.id, {
      onLocalStream: (s) => !cancelled && setLocalStream(s),
      onPeers: (next) => !cancelled && setPeers(next),
      onState: (_s, detail) => !cancelled && detail && setTrackerDetail(detail),
    });
    return () => {
      cancelled = true;
      call.stop();
    };
  }, [match?.id]);

  const attachTracker = useCallback(
    (element: HTMLVideoElement) => {
      if (startedRef.current || !match) return;
      startedRef.current = true;
      poseTracker.startPunches(element, {
        onState: (s, detail) => {
          setTracker(s);
          if (detail) setTrackerDetail(detail);
        },
        onPunch: (update) => {
          setPunches(update.punches);
          setCombo(update.combo);
          setMultiplier(update.multiplier);
          setScore(update.score);
          setHint(update.hint);
          scoreRef.current = update.score;
          if (update.landed) {
            // Relay only when a punch lands, so the socket is not written to
            // once per frame.
            api.sendGameAction(match.id, 'punch', { score: update.score });
            setFlash(true);
            setTimeout(() => setFlash(false), 90);
          }
        },
      });
    },
    [match?.id],
  );

  useEffect(() => {
    const off = api.onGameAction(({ action, payload }) => {
      if (action === 'punch' && typeof payload?.score === 'number') {
        setOpponentScore(payload.score as number);
      }
    });
    const offFinished = api.onMatchFinished((data) => {
      const payload = data as {
        outcome?: string;
        winner?: string | null;
        results?: { name: string; rating_change?: number | null; rating?: number | null }[];
      };
      if (payload.outcome === 'stalemate') {
        setOutcome('Stalemate: your opponent disconnected. No rating changed.');
      } else if (payload.outcome === 'draw') {
        setOutcome('Draw. Identical scores, so neither rating moved.');
      } else if (payload.winner) {
        const headline = payload.winner === me ? 'You win.' : 'You lose.';
        const mine = payload.results?.find((row) => row.name === me);
        const delta = mine?.rating_change;
        setOutcome(
          delta === undefined || delta === null
            ? `${headline} Unrated: guests have no rating to stake.`
            : `${headline} ${delta >= 0 ? '+' : ''}${delta} rating, now ${mine?.rating}.`,
        );
      } else {
        setOutcome('Match finished.');
      }
      setFinished(true);
    });
    return () => {
      off();
      offFinished();
    };
  }, [me]);

  // Countdown, then submit once.
  useEffect(() => {
    if (finished || !match) return;
    if (secondsLeft <= 0) {
      setFinished(true);
      clearMatchClock(match.id);
      poseTracker.stop();
      const final = scoreRef.current;
      submitResult(match.id, { score: final, rep_count: punches, duration_sec: duration })
        .then(() => setOutcome(`Time. ${punches} punches for ${final} points.`))
        .catch(() => setOutcome('Time, but the score could not be saved.'));
      return;
    }
  }, [secondsLeft, finished, match?.id, punches, duration, submitResult]);

  if (!match) return null;

  const toNextMultiplier = PUNCHES_PER_MULTIPLIER - (combo % PUNCHES_PER_MULTIPLIER);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.game}>Shadow Boxing</Text>
          <Text style={styles.sub}>Ranked 1v1</Text>
        </View>
        {/* A match that is over has no time left in it. */}
        <Text style={[styles.clock, !finished && secondsLeft <= 10 && { color: T.danger }]}>
          {finished ? 'Over' : `${secondsLeft}s`}
        </Text>
      </View>

      <View style={styles.scores}>
        <View style={styles.scoreBox}>
          <Text style={styles.scoreLabel}>YOU</Text>
          <Text style={[styles.score, flash && { color: accent }]}>{score}</Text>
          <Text style={styles.punches}>{punches} punches</Text>
        </View>
        <View style={styles.scoreBox}>
          <Text style={styles.scoreLabel}>OPPONENT</Text>
          <Text style={styles.score}>{opponentScore}</Text>
        </View>
      </View>

      <View style={[styles.comboBar, multiplier > 1 && { borderColor: accent }]}>
        <Text style={[styles.multiplier, multiplier > 1 && { color: accent }]}>
          ×{multiplier}
        </Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.comboText}>
            {combo === 0
              ? 'Start punching to build a combo'
              : `${combo} in a row`}
          </Text>
          <Text style={styles.comboHint}>
            {multiplier >= 5
              ? 'Maximum multiplier. Keep it alive.'
              : `${toNextMultiplier} more for ×${multiplier + 1}`}
          </Text>
        </View>
      </View>

      <View style={styles.cameraWrap}>
        <VideoGrid
          localStream={localStream}
          peers={peers}
          myName={me}
          state="connecting"
          muted={muted}
          cameraOff={cameraOff}
          onToggleMute={() => {
            const nextMuted = !muted;
            setMuted(nextMuted);
            call.setMuted(nextMuted);
          }}
          onToggleCamera={() => {
            const nextOff = !cameraOff;
            setCameraOff(nextOff);
            call.setCameraOff(nextOff);
          }}
          onLocalReady={attachTracker}
          selfOverlay={
            <>
              {tracker === 'loading' && (
                <View style={styles.overlay}>
                  <ActivityIndicator color={accent} />
                  <Text style={styles.overlayText}>Loading the punch tracker…</Text>
                </View>
              )}
              {tracker === 'failed' && (
                <View style={styles.overlay}>
                  <Text style={styles.overlayText}>{trackerDetail ?? 'Punch tracking unavailable'}</Text>
                </View>
              )}
            </>
          }
        />
      </View>

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {finished ? (
        <MatchOutcome outcome={outcome} onNext={findNextMatch} onBack={leaveMatch} />
      ) : (
        <TouchableOpacity
          style={[styles.forfeit, { backgroundColor: accent }]}
          onPress={forfeit}
        >
          <Text style={[styles.forfeitText, { color: ink }]}>Forfeit</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg, padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  game: { color: T.text, fontSize: 20, fontWeight: '900' },
  sub: { color: T.textDim, fontSize: 12, marginTop: 2 },
  clock: { color: T.text, fontSize: 34, fontWeight: '900' },
  scores: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  scoreBox: {
    flex: 1,
    backgroundColor: T.surface,
    borderRadius: T.radius,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: T.border,
  },
  scoreLabel: { color: T.textDim, fontSize: 10, letterSpacing: 1.4, fontWeight: '700' },
  score: { color: T.text, fontSize: 34, fontWeight: '900' },
  punches: { color: T.textDim, fontSize: 11 },
  comboBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: T.surface,
    borderRadius: T.radius,
    borderWidth: 1,
    borderColor: T.border,
    padding: 12,
    marginBottom: 12,
  },
  multiplier: { color: T.textDim, fontSize: 26, fontWeight: '900' },
  comboText: { color: T.text, fontSize: 14, fontWeight: '700' },
  comboHint: { color: T.textDim, fontSize: 11, marginTop: 2 },
  cameraWrap: {
    flex: 1,
    borderRadius: T.radius,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  overlayText: { color: T.textDim, fontSize: 13, textAlign: 'center', paddingHorizontal: 20 },
  hint: { color: '#f59e0b', fontSize: 12, marginTop: 10, textAlign: 'center' },
  forfeit: { marginTop: 12, paddingVertical: 14, borderRadius: T.radius, alignItems: 'center' },
  forfeitText: { fontWeight: '900', fontSize: 15 },
  done: { marginTop: 12, padding: 14, backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.border },
  doneText: { color: T.text, textAlign: 'center', fontWeight: '700' },
});
