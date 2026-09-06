// Trap Chat — Browse
// Every open social room, with a code box for a room someone sent you and a
// way to open your own with whatever name you want.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useApp } from '../context/AppContext';
import api, { SocialRoom } from '../services/api';
import { GameSlug } from '../types';

export function BrowseScreen({ onEntered }: { onEntered?: () => void }) {
  const { state, joinRoomByCode, createNamedRoom } = useApp();
  const [rooms, setRooms] = useState<SocialRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [newName, setNewName] = useState('');
  const [mode, setMode] = useState<'chat1v1' | 'groupchat'>('groupchat');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRooms(await api.listRooms());
    } catch (err: any) {
      setError(err?.message ?? 'Could not load rooms');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onEntered?.();
    } catch (err: any) {
      setError(err?.message ?? 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  const social = state.games.filter((g) => g.category === 'social');

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* JOIN A ROOM SOMEONE SENT YOU */}
      <Text style={styles.section}>JOIN BY CODE</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="e.g. 7F46927E"
          placeholderTextColor="#a1a1a1"
          onSubmitEditing={() => run(() => joinRoomByCode(code))}
        />
        <TouchableOpacity
          style={[styles.primary, (busy || !code.trim()) && styles.disabled]}
          disabled={busy || !code.trim()}
          onPress={() => run(() => joinRoomByCode(code))}
        >
          <Text style={styles.primaryText}>Join</Text>
        </TouchableOpacity>
      </View>

      {/* OPEN YOUR OWN, NAMED */}
      <Text style={styles.section}>START A ROOM</Text>
      <TextInput
        style={[styles.input, styles.fullInput]}
        value={newName}
        onChangeText={setNewName}
        placeholder="Name it whatever you want"
        placeholderTextColor="#a1a1a1"
      />
      <View style={styles.modeRow}>
        {social.map((game) => (
          <TouchableOpacity
            key={game.slug}
            style={[styles.mode, mode === game.slug && styles.modeActive]}
            onPress={() => setMode(game.slug as 'chat1v1' | 'groupchat')}
          >
            <Text style={[styles.modeText, mode === game.slug && styles.modeTextActive]}>
              {game.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity
        style={[styles.primaryWide, busy && styles.disabled]}
        disabled={busy}
        onPress={() => run(() => createNamedRoom(mode as GameSlug, newName))}
      >
        <Text style={styles.primaryText}>Create and join</Text>
      </TouchableOpacity>

      {/* EVERYTHING THAT IS OPEN */}
      <View style={styles.openHeader}>
        <Text style={styles.section}>OPEN ROOMS</Text>
        <TouchableOpacity onPress={refresh}>
          <Text style={styles.refresh}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color="#FE2C55" style={{ marginTop: 16 }} />
      ) : rooms.length === 0 ? (
        <Text style={styles.empty}>Nothing open right now. Start one above.</Text>
      ) : (
        rooms.map((room) => {
          const full = room.player_count >= room.max_players;
          return (
            <TouchableOpacity
              key={room.code}
              style={[styles.room, (busy || full) && styles.disabled]}
              disabled={busy || full}
              onPress={() => run(() => joinRoomByCode(room.code))}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.roomName}>{room.name}</Text>
                <Text style={styles.roomMeta}>
                  {room.game_name} · {room.player_count}/{room.max_players}
                  {room.players.length ? ` · ${room.players.map((p) => p.display_name).join(', ')}` : ''}
                </Text>
              </View>
              <Text style={styles.roomAction}>{full ? 'Full' : 'Join'}</Text>
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  content: { padding: 18, paddingBottom: 44 },
  section: { color: '#a1a1a1', fontSize: 10, letterSpacing: 1.5, fontWeight: '700', marginTop: 18, marginBottom: 9 },
  row: { flexDirection: 'row', gap: 10 },
  input: { flex: 1, backgroundColor: '#121212', color: '#fff', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12 },
  fullInput: { flex: 0 },
  primary: { backgroundColor: '#FE2C55', borderRadius: 8, paddingHorizontal: 22, justifyContent: 'center' },
  primaryWide: { backgroundColor: '#FE2C55', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  primaryText: { color: '#fff', fontWeight: '800' },
  disabled: { opacity: 0.45 },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  mode: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: '#121212' },
  modeActive: { backgroundColor: '#FE2C55' },
  modeText: { color: '#a1a1a1', fontWeight: '700', fontSize: 13 },
  modeTextActive: { color: '#fff' },
  openHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  refresh: { color: '#FE2C55', fontWeight: '700', marginTop: 18, marginBottom: 9 },
  room: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#121212', borderRadius: 8, padding: 15, marginBottom: 9 },
  roomName: { color: '#fff', fontWeight: '700', fontSize: 15 },
  roomMeta: { color: '#a1a1a1', fontSize: 11, marginTop: 3 },
  roomAction: { color: '#FE2C55', fontWeight: '800' },
  empty: { color: '#a1a1a1', fontStyle: 'italic' },
  error: { color: '#FE2C55', marginBottom: 10 },
});
