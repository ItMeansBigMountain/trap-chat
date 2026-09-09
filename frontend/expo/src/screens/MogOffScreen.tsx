// Trap Chat — Mog Off
// Thirty seconds on camera, and the higher facial symmetry score wins.
//
// It measures symmetry and says so. A model cannot rank faces by how good
// they look, and one that claimed to would be dishonest as well as unpleasant.
// Symmetry is a real geometric property, it is measurable from landmarks, and
// it is what this game was before it got a nickname.
//
// Because the result is a number, this game settles the way push-ups do:
// higher score wins, and the ladder moves. No vote is involved.

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
import faceTracker, { FaceTrackerState } from '../services/faceTracker';
import { useAccent } from '../hooks/useAccent';
import { FaceOverlay } from '../components/FaceOverlay';
import { FacePoint } from '../services/faceScorer';
import { T } from '../theme';

const isWeb = Platform.OS === 'web';


export function MogOffScreen() {
  const { state, forfeit, submitResult, findNextMatch, leaveMatch } = useApp();
  const { accent, ink } = useAccent();
  const match = state.currentMatch;
  const duration = match?.game?.default_time_sec || 30;

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
  const [score, setScore] = useState(0);
  const [live, setLive] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [tracker, setTracker] = useState<FaceTrackerState>('idle');
  // What the score is being taken from. On by default: a number with nothing
  // behind it is not something anybody can argue with or trust.
  const [showLines, setShowLines] = useState(true);
  const [landmarks, setLandmarks] = useState<FacePoint[] | null>(null);
  const [trackerDetail, setTrackerDetail] = useState<string | undefined>();
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
      faceTracker.stop();
    };
  }, [match?.id]);

  const attachTracker = useCallback(
    (element: HTMLVideoElement) => {
      if (startedRef.current || !match) return;
      startedRef.current = true;
      faceTracker.start(element, {
        onState: (s, detail) => {
          setTracker(s);
          if (detail) setTrackerDetail(detail);
        },
        onScore: (running, frame) => {
          setScore(running);
          setLive(frame);
          scoreRef.current = running;
        },
        onLandmarks: setLandmarks,
      });
    },
    [match?.id],
  );

  // The running score is relayed so both sides can watch it move.
  useEffect(() => {
    if (!match || finished) return;
    const timer = setInterval(() => {
      api.sendGameAction(match.id, 'mog', { score: scoreRef.current });
    }, 1000);
    return () => clearInterval(timer);
  }, [match?.id, finished]);

  useEffect(() => {
    const off = api.onGameAction(({ action, payload }) => {
      if (action === 'mog' && typeof payload?.score === 'number') {
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

  useEffect(() => {
    if (finished || !match) return;
    if (secondsLeft <= 0) {
      setFinished(true);
      clearMatchClock(match.id);
      faceTracker.stop();
      const final = scoreRef.current;
      submitResult(match.id, { score: final, duration_sec: duration })
        .then(() => setOutcome(`Time. Your symmetry scored ${final}.`))
        .catch(() => setOutcome('Time, but the score could not be saved.'));
      return;
    }
  }, [secondsLeft, finished, match?.id, duration, submitResult]);

  if (!match) return null;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.game}>Mog Off</Text>
          <Text style={styles.sub}>Facial symmetry, measured</Text>
        </View>
        {/* A match that is over has no time left in it. */}
        <Text style={[styles.clock, !finished && secondsLeft <= 5 && { color: T.danger }]}>
          {finished ? 'Over' : `${secondsLeft}s`}
        </Text>
      </View>

      <View style={styles.scores}>
        <View style={styles.scoreBox}>
          <Text style={styles.scoreLabel}>YOU</Text>
          <Text style={[styles.score, { color: accent }]}>{score}</Text>
          <Text style={styles.live}>this frame {live}</Text>
        </View>
        <View style={styles.scoreBox}>
          <Text style={styles.scoreLabel}>OPPONENT</Text>
          <Text style={styles.score}>{opponentScore}</Text>
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
              {/* The lines belong on your own face, so they go on your tile
                  rather than over the whole grid. */}
              <FaceOverlay points={landmarks} accent={accent} visible={showLines} />
              {tracker === 'loading' && (
                <View style={styles.overlay}>
                  <ActivityIndicator color={accent} />
                  <Text style={styles.overlayText}>Loading the face model…</Text>
                </View>
              )}
              {tracker === 'failed' && (
                <View style={styles.overlay}>
                  <Text style={styles.overlayText}>{trackerDetail ?? 'Face tracking unavailable'}</Text>
                </View>
              )}
            </>
          }
        />
        {/* The toggle stays outside the tile: half a tile is a small target,
            and this is a control rather than part of the picture. */}
        {tracker === 'running' ? (
          <TouchableOpacity
            style={[styles.linesToggle, showLines && { borderColor: accent }]}
            onPress={() => setShowLines((on) => !on)}
            accessibilityRole="switch"
            accessibilityState={{ checked: showLines }}
            accessibilityLabel={showLines ? 'Hide the measurement' : 'Show the measurement'}
          >
            <Text style={[styles.linesToggleText, showLines && { color: accent }]}>
              {showLines ? 'Lines on' : 'Lines off'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={styles.explain}>
        This measures how symmetric your face is, not how good it looks. The
        lines are the measurement: the centre line is the axis, and each pair
        is compared against it. Face the camera straight on — turning your head
        makes those pairs uneven, which is what lowers the score.
      </Text>

      {finished ? (
        <MatchOutcome outcome={outcome} onNext={findNextMatch} onBack={leaveMatch} />
      ) : (
        <TouchableOpacity style={[styles.forfeit, { backgroundColor: accent }]} onPress={forfeit}>
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
  scores: { flexDirection: 'row', gap: 12, marginBottom: 12 },
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
  live: { color: T.textFaint, fontSize: 11 },
  cameraWrap: { flex: 1, borderRadius: T.radius, overflow: 'hidden', backgroundColor: '#000', position: 'relative' },
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  overlayText: { color: T.textDim, fontSize: 13, textAlign: 'center', paddingHorizontal: 20 },
  linesToggle: {
    position: 'absolute',
    right: 10,
    top: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  linesToggleText: { color: T.textDim, fontWeight: '800', fontSize: 11 },
  explain: { color: T.textDim, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 10 },
  forfeit: { marginTop: 12, paddingVertical: 14, borderRadius: T.radius, alignItems: 'center' },
  forfeitText: { fontWeight: '900', fontSize: 15 },
  done: { marginTop: 12, padding: 14, backgroundColor: T.surface, borderRadius: T.radius, borderWidth: 1, borderColor: T.border },
  doneText: { color: T.text, textAlign: 'center', fontWeight: '700' },
});
