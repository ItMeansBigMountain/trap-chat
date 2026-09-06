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
  const competitive = state.games.filter((g) => g.category === 'competitive');
  const isSearching = state.isSearching;

  // Name the identity that is queued. Two tabs of one browser share
  // localStorage and are therefore one person, and seeing the same name in
  // both is the fastest way to notice that.
  const queuedAs =
    state.auth.status === 'authenticated'
      ? state.auth.user.username
      : state.auth.status === 'guest'
      ? state.auth.session.display_name
      : null;

  // A queue with nobody else in it looks identical to a broken one. Count the
  // wait so it is visibly progressing, then explain what is actually needed.
  useEffect(() => {
    if (!isSearching) {
      setWaitedSeconds(0);
      return;
    }
    const tick = setInterval(() => setWaitedSeconds((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, [isSearching]);

  const queue = async (slug: GameSlug) => {
    setError(null);
    try {
      await startSearch(slug);
    } catch (err: any) {
      setError(err?.message ?? 'Could not join the queue');
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {isSearching && (
        <View style={styles.queued}>
          <ActivityIndicator color="#FE2C55" />
          <View style={{ flex: 1 }}>
            <Text style={styles.queuedTitle}>
              Finding an opponent near your rating · {waitedSeconds}s
            </Text>
            {queuedAs ? <Text style={styles.queuedAs}>Queued as {queuedAs}</Text> : null}
            <Text style={styles.queuedHint}>
              {waitedSeconds < 15
                ? 'You will drop into the match automatically.'
                : 'Nobody else is queued for this game yet. If your other tab shows this same name, it is the same account: two tabs of one browser share a login and cannot be matched together. Use a different browser or a private window.'}
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
  queuedAs: { color: '#FE2C55', fontSize: 11, fontWeight: '700', marginTop: 2 },
  queuedHint: { color: '#a1a1a1', fontSize: 11, marginTop: 3, lineHeight: 16 },
  cancel: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1f1f1f' },
  cancelText: { color: '#FE2C55', fontWeight: '700' },
  error: { color: '#FE2C55', marginBottom: 12 },
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
