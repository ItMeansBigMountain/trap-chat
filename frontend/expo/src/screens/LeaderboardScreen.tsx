// Trap Chat — Leaderboards
// One board per competitive game. Social channels are never ranked, so they do
// not appear here.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useApp } from '../context/AppContext';
import api from '../services/api';
import { GameSlug, LeaderboardEntry } from '../types';

export function LeaderboardScreen() {
  const { state } = useApp();
  const competitive = state.games.filter((g) => g.category === 'competitive');
  const [selected, setSelected] = useState<string | null>(null);
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = selected ?? competitive[0]?.slug ?? null;

  const load = useCallback(async (slug: string) => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api.getLeaderboard(slug as GameSlug));
    } catch (err: any) {
      setError(err?.message ?? 'Could not load the leaderboard');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) load(active);
  }, [active, load]);

  return (
    <View style={styles.root}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsWrap} contentContainerStyle={styles.tabs}>
        {competitive.map((game) => (
          <TouchableOpacity
            key={game.slug}
            style={[styles.tab, active === game.slug && styles.tabActive]}
            onPress={() => setSelected(game.slug)}
          >
            <Text style={[styles.tabText, active === game.slug && styles.tabTextActive]}>
              {game.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {loading ? (
          <ActivityIndicator color="#CCFF00" style={{ marginTop: 24 }} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>
            No scores yet. Win a ranked match and you will be the first name here.
          </Text>
        ) : (
          rows.map((row, index) => (
            <View key={`${row.username}-${index}`} style={styles.row}>
              <Text style={styles.rank}>{row.rank ?? index + 1}</Text>
              <Text style={styles.name}>{row.username}</Text>
              <Text style={styles.score}>{row.score}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  tabsWrap: { flexGrow: 0 },
  tabs: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  tab: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: '#121212' },
  tabActive: { backgroundColor: '#CCFF00' },
  tabText: { color: '#a1a1a1', fontWeight: '700', fontSize: 13 },
  // Black on lime: white on it is unreadable.
  tabTextActive: { color: '#000' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 18, paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#121212',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  rank: { color: '#CCFF00', fontWeight: '900', width: 34, fontSize: 15 },
  name: { color: '#fff', flex: 1, fontWeight: '600' },
  score: { color: '#ffffff', fontWeight: '800' },
  empty: { color: '#a1a1a1', fontStyle: 'italic', marginTop: 20, lineHeight: 20 },
  error: { color: '#FF4757', marginTop: 20 },
});
