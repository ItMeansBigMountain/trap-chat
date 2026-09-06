// Trap Chat — Competitive
// Ranked 1v1 only. There is no room code here on purpose: matchmaking pairs
// you by rating, and that is what makes the leaderboard mean anything.

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useApp } from '../context/AppContext';
import api, { QueueState } from '../services/api';
import { GameSlug } from '../types';

const ART: Record<string, { icon: string; blurb: string }> = {
  pushups: { icon: '💪', blurb: 'Most reps in 60s' },
  squats: { icon: '🦵', blurb: 'Deep squat showdown' },
  rapbattle: { icon: '🎤', blurb: '60s freestyle battle' },
  looks: { icon: '📏', blurb: 'Symmetry and looksmaxx' },
};

export function CompetitiveScreen() {
  const { state, startSearch, cancelSearch } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [waitedSeconds, setWaitedSeconds] = useState(0);
  const [queuedFor, setQueuedFor] = useState<GameSlug | null>(null);
  const [queue_, setQueueState] = useState<QueueState | null>(null);
  const competitive = state.games.filter((g) => g.category === 'competitive');
  const isSearching = state.isSearching;

  // A queue with nobody else in it looks identical to a broken one. Count the
  // wait so it is visibly progressing.
  useEffect(() => {
    if (!isSearching) {
      setWaitedSeconds(0);
      setQueueState(null);
      return;
    }
    const tick = setInterval(() => setWaitedSeconds((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, [isSearching]);

  // Ask the server who is actually waiting rather than inferring it from the
  // fact that nothing has happened. Inferring it was wrong whenever two people
  // queued for different games, which looks exactly like broken matchmaking.
  useEffect(() => {
    if (!isSearching || !queuedFor) return;
    let stopped = false;
    const poll = async () => {
      try {
        const next = await api.getQueue(queuedFor);
        if (!stopped) setQueueState(next);
      } catch {
        // A failed poll is not worth surfacing: the queue itself is fine.
      }
    };
    void poll();
    const timer = setInterval(poll, 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [isSearching, queuedFor]);

  const queue = async (slug: GameSlug) => {
    setError(null);
    setQueuedFor(slug);
    try {
      await startSearch(slug);
    } catch (err: any) {
      setQueuedFor(null);
      setError(err?.message ?? 'Could not join the queue');
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {isSearching && (
        <View style={styles.queued}>
          <ActivityIndicator color="#CCFF00" />
          <View style={{ flex: 1 }}>
            <Text style={styles.queuedTitle}>
              {queue_?.game_name ?? 'Finding an opponent'} · {waitedSeconds}s
            </Text>
            <Text style={styles.queuedAs}>
              {queue_ === null
                ? 'Joining the queue…'
                : queue_.others_waiting > 0
                ? `${queue_.others_waiting} other ${
                    queue_.others_waiting === 1 ? 'player' : 'players'
                  } waiting — pairing you now`
                : 'You are the only one in this queue'}
            </Text>
            <Text style={styles.queuedHint}>
              {queue_ !== null && queue_.others_waiting === 0 && waitedSeconds >= 12
                ? 'Each game has its own queue, so an opponent has to pick this same one. Leave it running and you will drop in the moment somebody does.'
                : 'You will drop into the match automatically.'}
            </Text>
          </View>
          <TouchableOpacity onPress={cancelSearch} style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.lead}>
        Ranked matchmaking. Once a match starts you play it out: forfeit to leave
        early, and a disconnect is a stalemate.
      </Text>

      {competitive.length === 0 ? (
        <Text style={styles.empty}>No competitive games available.</Text>
      ) : (
        <View style={styles.grid}>
          {competitive.map((game) => {
            const art = ART[game.slug] ?? { icon: '🎮', blurb: '' };
            return (
              <TouchableOpacity
                key={game.slug}
                style={[styles.card, isSearching && styles.cardDisabled]}
                disabled={isSearching}
                onPress={() => queue(game.slug as GameSlug)}
              >
                <Text style={styles.cardIcon}>{art.icon}</Text>
                <Text style={styles.cardTitle}>{game.name}</Text>
                <Text style={styles.cardBlurb}>{art.blurb}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  content: { padding: 18, paddingBottom: 40 },
  lead: { color: '#a1a1a1', fontSize: 13, lineHeight: 19, marginBottom: 18 },
  queued: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#121212',
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
  },
  queuedTitle: { color: '#fff', fontWeight: '700', fontSize: 14 },
  queuedAs: { color: '#CCFF00', fontSize: 11, fontWeight: '700', marginTop: 2 },
  queuedHint: { color: '#a1a1a1', fontSize: 11, marginTop: 3, lineHeight: 16 },
  cancel: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1f1f1f' },
  cancelText: { color: '#CCFF00', fontWeight: '700' },
  error: { color: '#FF4757', marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: {
    width: '47%',
    minWidth: 150,
    flexGrow: 1,
    backgroundColor: '#121212',
    borderRadius: 8,
    padding: 18,
    alignItems: 'center',
  },
  cardDisabled: { opacity: 0.45 },
  cardIcon: { fontSize: 32 },
  cardTitle: { color: '#fff', fontWeight: '800', fontSize: 16, marginTop: 10 },
  cardBlurb: { color: '#a1a1a1', fontSize: 11, marginTop: 4, textAlign: 'center' },
  empty: { color: '#a1a1a1', fontStyle: 'italic' },
});
