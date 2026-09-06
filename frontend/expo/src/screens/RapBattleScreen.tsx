// Trap Chat — Rap Battle
// Two rappers, one beat, one turn each, then the room decides.
//
// The split matters. The machine measures whether you were on the beat, which
// it can do exactly because it is playing the beat. It does not decide who
// won, because no algorithm can tell a good bar from a bad one, and every
// serious battle rap platform settles it the same way: the audience votes.
// The flow score is shown next to the vote and breaks a tie.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useApp } from '../context/AppContext';
import api, { VoteRow } from '../services/api';
import { BEATS, Beat, FlowScorer, FlowResult } from '../services/flowScorer';
import { BeatMachine } from '../services/beatMachine';
import { OnsetDetector, micSupported } from '../services/onsetDetector';
import { T } from '../theme';

const TURN_SECONDS = 60;

type Phase = 'beat' | 'ready' | 'rapping' | 'listening' | 'voting';

export function RapBattleScreen() {
  const { state, leaveMatch } = useApp();
  const match = state.currentMatch;

  const [phase, setPhase] = useState<Phase>('beat');
  const [beat, setBeat] = useState<Beat>(BEATS[0]);
  const [left, setLeft] = useState(TURN_SECONDS);
  const [tightness, setTightness] = useState(0);
  const [bars, setBars] = useState(0);
  const [flow, setFlow] = useState<FlowResult | null>(null);
  const [tally, setTally] = useState<VoteRow[]>([]);
  const [myVote, setMyVote] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const machine = useRef<BeatMachine | null>(null);
  const detector = useRef<OnsetDetector | null>(null);
  const scorer = useRef<FlowScorer | null>(null);
  const stream = useRef<MediaStream | null>(null);

  const me =
    state.auth.status === 'authenticated'
      ? state.auth.user.username
      : state.auth.status === 'guest'
      ? state.auth.session.display_name
      : 'You';

  const teardown = useCallback(() => {
    detector.current?.stop();
    machine.current?.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    detector.current = null;
    machine.current = null;
    stream.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const loadVotes = useCallback(async () => {
    if (!match) return;
    try {
      const votes = await api.getVotes(match.id);
      setTally(votes.tally);
      setMyVote(votes.my_vote);
    } catch (err: any) {
      setError(err?.message ?? 'Could not load the vote');
    }
  }, [match?.id]);

  useEffect(() => {
    const off = api.onVoteUpdate(({ tally: next }) => setTally(next));
    return off;
  }, []);

  // ---------- THE TURN ----------
  const startTurn = useCallback(async () => {
    if (!match) return;
    setError(null);
    if (!micSupported()) {
      setError('This browser cannot record audio, so a battle cannot be scored here.');
      return;
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access is required to rap.');
      return;
    }

    const flowScorer = new FlowScorer(beat, TURN_SECONDS);
    scorer.current = flowScorer;
    const beatMachine = new BeatMachine(beat);
    machine.current = beatMachine;
    await beatMachine.start();

    // Timestamp every syllable on the beat machine's own clock, so an onset
    // and the grid it is measured against cannot drift apart.
    const onsets = new OnsetDetector(() => {
      flowScorer.add(beatMachine.now());
      setTightness(flowScorer.lastTightness());
      setBars(flowScorer.result().bars);
    });
    detector.current = onsets;
    await onsets.start(stream.current);

    setPhase('rapping');
    setLeft(TURN_SECONDS);
  }, [match?.id, beat]);

  useEffect(() => {
    if (phase !== 'rapping') return;
    if (left <= 0) {
      const result = scorer.current?.result() ?? null;
      setFlow(result);
      teardown();
      setPhase('voting');
      void loadVotes();
      if (match && result) {
        // The flow score is a stat, not a placing. It is submitted so both
        // sides can see it, and so a tied vote has something to break it.
        api.sendGameAction(match.id, 'flow', {
          score: result.score,
          bars: result.bars,
          accuracy: Math.round(result.accuracy * 100),
        });
      }
      return;
    }
    const tick = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(tick);
  }, [phase, left, teardown, loadVotes, match?.id]);

  const vote = async (playerId: number) => {
    if (!match) return;
    setError(null);
    try {
      const result = await api.castVote(match.id, playerId);
      setTally(result.tally);
      setMyVote(result.my_vote);
    } catch (err: any) {
      setError(err?.message ?? 'Could not record that vote');
    }
  };

  if (!match) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={T.accent} />
      </View>
    );
  }

  // ---------- BEAT PICKER ----------
  if (phase === 'beat') {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Text style={styles.h1}>Pick a beat</Text>
        <Text style={styles.lead}>
          Everything is timed against this beat, so pick the one you want to rap
          over. You get {TURN_SECONDS} seconds.
        </Text>
        {BEATS.map((option) => (
          <TouchableOpacity
            key={option.slug}
            style={[styles.beatRow, beat.slug === option.slug && styles.beatRowOn]}
            onPress={() => setBeat(option)}
          >
            <Text style={styles.beatTitle}>{option.title}</Text>
            <Text style={styles.beatBpm}>{option.bpm} BPM</Text>
          </TouchableOpacity>
        ))}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.cta} onPress={() => setPhase('ready')}>
          <Text style={styles.ctaText}>Use {beat.title}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quiet} onPress={leaveMatch}>
          <Text style={styles.quietText}>Forfeit</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ---------- READY ----------
  if (phase === 'ready') {
    return (
      <View style={styles.centre}>
        <Text style={styles.h1}>{beat.title}</Text>
        <Text style={styles.lead}>
          {beat.bpm} BPM. The beat starts when you do. Stay on it: the meter
          shows how tight you are landing.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.cta} onPress={startTurn}>
          <Text style={styles.ctaText}>Start my turn</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quiet} onPress={() => setPhase('beat')}>
          <Text style={styles.quietText}>Change beat</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---------- RAPPING ----------
  if (phase === 'rapping') {
    return (
      <View style={styles.centre}>
        <Text style={styles.clock}>{left}s</Text>
        <Text style={styles.beatLabel}>
          {beat.title} · {beat.bpm} BPM
        </Text>

        <View style={styles.meter}>
          <View style={[styles.meterFill, { width: `${Math.round(tightness * 100)}%` }]} />
        </View>
        <Text style={styles.meterLabel}>
          {tightness > 0.75 ? 'ON BEAT' : tightness > 0.4 ? 'CLOSE' : 'OFF BEAT'}
        </Text>

        <Text style={styles.bars}>{bars.toFixed(1)} bars</Text>

        <TouchableOpacity style={styles.quiet} onPress={() => setLeft(0)}>
          <Text style={styles.quietText}>End my turn</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---------- VOTING ----------
  const total = tally.reduce((sum, row) => sum + row.votes, 0);
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>The room decides</Text>
      <Text style={styles.lead}>
        A machine can tell who was on beat. It cannot tell who was better, so
        that is the audience's call. You cannot vote for yourself.
      </Text>

      {flow ? (
        <View style={styles.flowCard}>
          <Text style={styles.flowLabel}>YOUR FLOW</Text>
          <Text style={styles.flowScore}>{flow.score}</Text>
          <Text style={styles.flowDetail}>
            {flow.onBeat}/{flow.total} syllables on the grid · {flow.bars.toFixed(1)} bars ·{' '}
            {Math.round(flow.coverage * 100)}% of the turn used
          </Text>
          <Text style={styles.flowNote}>Breaks a tied vote. Nothing more.</Text>
        </View>
      ) : null}

      {tally.map((row) => {
        const isMe = row.display_name === me;
        const share = total ? Math.round((row.votes / total) * 100) : 0;
        return (
          <View key={row.player_id} style={styles.voteRow}>
            <View style={styles.voteHead}>
              <Text style={styles.voteName}>{row.display_name}</Text>
              <Text style={styles.voteCount}>
                {row.votes} {row.votes === 1 ? 'vote' : 'votes'}
              </Text>
            </View>
            <View style={styles.voteBar}>
              <View style={[styles.voteFill, { width: `${share}%` }]} />
            </View>
            <TouchableOpacity
              style={[
                styles.voteButton,
                myVote === row.player_id && styles.voteButtonOn,
                isMe && styles.voteButtonOff,
              ]}
              disabled={isMe}
              onPress={() => vote(row.player_id)}
            >
              <Text style={styles.voteButtonText}>
                {isMe ? 'That is you' : myVote === row.player_id ? 'Your vote' : 'Vote'}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.quiet} onPress={leaveMatch}>
        <Text style={styles.quietText}>Leave battle</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  content: { padding: 20, paddingBottom: 40 },
  centre: { flex: 1, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center', padding: 26 },
  h1: { color: T.text, fontSize: 26, fontWeight: '900' },
  lead: { color: T.textDim, fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 18, textAlign: 'center' },

  beatRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: T.surface, borderRadius: T.radius, padding: 15, marginBottom: 10,
    borderWidth: 1, borderColor: T.border,
  },
  beatRowOn: { borderColor: T.accent },
  beatTitle: { color: T.text, fontWeight: '800', fontSize: 16 },
  beatBpm: { color: T.textDim, fontSize: 12, fontWeight: '700' },

  clock: { color: T.text, fontSize: 64, fontWeight: '900' },
  beatLabel: { color: T.textDim, fontSize: 13, marginTop: 2 },
  meter: {
    width: '100%', maxWidth: 320, height: 12, borderRadius: 6,
    backgroundColor: T.surfaceHi, marginTop: 30, overflow: 'hidden',
  },
  meterFill: { height: '100%', backgroundColor: T.accent },
  meterLabel: { color: T.text, fontWeight: '800', fontSize: 13, marginTop: 8, letterSpacing: 1.5 },
  bars: { color: T.textDim, fontSize: 14, marginTop: 18, fontWeight: '700' },

  flowCard: {
    backgroundColor: T.surface, borderRadius: T.radius, padding: 16,
    borderWidth: 1, borderColor: T.border, marginBottom: 18,
  },
  flowLabel: { color: T.textDim, fontSize: 10, letterSpacing: 1.4, fontWeight: '700' },
  flowScore: { color: T.accent, fontSize: 40, fontWeight: '900' },
  flowDetail: { color: T.textDim, fontSize: 12, lineHeight: 17 },
  flowNote: { color: T.textFaint, fontSize: 11, marginTop: 6, fontStyle: 'italic' },

  voteRow: {
    backgroundColor: T.surface, borderRadius: T.radius, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: T.border,
  },
  voteHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  voteName: { color: T.text, fontWeight: '800', fontSize: 15 },
  voteCount: { color: T.textDim, fontSize: 12, fontWeight: '700' },
  voteBar: { height: 6, borderRadius: 3, backgroundColor: T.surfaceHi, marginTop: 8, overflow: 'hidden' },
  voteFill: { height: '100%', backgroundColor: T.accent },
  voteButton: {
    marginTop: 11, paddingVertical: 10, borderRadius: T.radius,
    backgroundColor: T.surfaceHi, alignItems: 'center',
  },
  voteButtonOn: { backgroundColor: T.accent },
  voteButtonOff: { opacity: 0.4 },
  voteButtonText: { color: T.text, fontWeight: '800', fontSize: 13 },

  cta: { marginTop: 14, backgroundColor: T.accent, paddingVertical: 15, paddingHorizontal: 44, borderRadius: T.radius },
  ctaText: { color: T.text, fontWeight: '900', fontSize: 16 },
  quiet: { marginTop: 16, paddingVertical: 12, paddingHorizontal: 26, alignItems: 'center' },
  quietText: { color: T.textDim, fontWeight: '700', fontSize: 13 },
  error: { color: T.accent, marginTop: 12, textAlign: 'center' },
});
