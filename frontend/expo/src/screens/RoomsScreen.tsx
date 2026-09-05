// Trap Chat — Rooms Screen
// Create a room for a game, join one by code, or pick from the open list.
// Entering a room lands in the same active-match state as quick matchmaking.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useApp } from '../context/AppContext';
import api from '../services/api';
import { GameSlug } from '../types';

interface OpenRoom {
  code: string;
  game: GameSlug;
  game_name: string;
  player_count: number;
}

export function RoomsScreen({ navigation }: { navigation: any }) {
  const { state, createRoom, joinRoomByCode } = useApp();
  const [rooms, setRooms] = useState<OpenRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = (await api.listRooms()) as unknown as OpenRoom[];
      setRooms(list);
    } catch (err: any) {
      Alert.alert('Could not load rooms', err.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onCreate = async (slug: GameSlug) => {
    setBusy(true);
    try {
      await createRoom(slug);
    } catch (err: any) {
      Alert.alert('Could not create room', err.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async (value: string) => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await joinRoomByCode(value);
    } catch (err: any) {
      Alert.alert('Could not join room', err.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Rooms</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>JOIN WITH A CODE</Text>
      <View style={styles.joinRow}>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="e.g. 7F46927E"
          placeholderTextColor="#6b7280"
          onSubmitEditing={() => onJoin(code)}
        />
        <TouchableOpacity
          style={[styles.primaryBtn, (busy || !code.trim()) && styles.disabled]}
          disabled={busy || !code.trim()}
          onPress={() => onJoin(code)}
        >
          <Text style={styles.primaryText}>Join</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>CREATE A ROOM</Text>
      {state.games.length === 0 ? (
        <Text style={styles.empty}>No games loaded.</Text>
      ) : (
        state.games.map((g) => (
          <TouchableOpacity
            key={g.slug}
            style={[styles.row, busy && styles.disabled]}
            disabled={busy}
            onPress={() => onCreate(g.slug as GameSlug)}
          >
            <Text style={styles.rowTitle}>{g.name}</Text>
            <Text style={styles.rowAction}>Create</Text>
          </TouchableOpacity>
        ))
      )}

      <View style={styles.openHeader}>
        <Text style={styles.section}>OPEN ROOMS</Text>
        <TouchableOpacity onPress={refresh}>
          <Text style={styles.refresh}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#6366f1" style={{ marginTop: 12 }} />
      ) : rooms.length === 0 ? (
        <Text style={styles.empty}>No open rooms. Create one above.</Text>
      ) : (
        rooms.map((r) => (
          <TouchableOpacity
            key={r.code}
            style={[styles.row, busy && styles.disabled]}
            disabled={busy}
            onPress={() => onJoin(r.code)}
          >
            <View>
              <Text style={styles.rowTitle}>{r.game_name ?? r.game}</Text>
              <Text style={styles.rowSub}>{r.code}</Text>
            </View>
            <Text style={styles.rowAction}>Join</Text>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f19' },
  content: { padding: 20, paddingTop: 52, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', flex: 1 },
  backBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1f2937' },
  backText: { color: '#9ca3af', fontWeight: '600' },
  section: { color: '#6b7280', fontSize: 11, letterSpacing: 1.5, marginTop: 18, marginBottom: 10 },
  joinRow: { flexDirection: 'row', gap: 10 },
  input: {
    flex: 1,
    backgroundColor: '#111827',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    letterSpacing: 2,
  },
  primaryBtn: { backgroundColor: '#6366f1', borderRadius: 10, paddingHorizontal: 22, justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.45 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  rowTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  rowSub: { color: '#818cf8', fontSize: 13, letterSpacing: 2, marginTop: 2 },
  rowAction: { color: '#818cf8', fontWeight: '700' },
  openHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  refresh: { color: '#818cf8', fontWeight: '600', marginTop: 18, marginBottom: 10 },
  empty: { color: '#6b7280', fontStyle: 'italic' },
});
