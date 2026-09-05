// Trap Chat — Lobby Screen
// Tiled layout: Chat mode | Competitive mode

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useApp } from '../context/AppContext';
import { GameSlug } from '../types';

// Game mode selection
const GAME_MODES: GameSlug[] = ['pushups', 'squats', 'rapbattle', 'symmetry', 'mog', 'textchat', 'ffa'];

const GAME_LABELS: Record<GameSlug, { title: string; subtitle: string; icon: string; max_reps: number; time: number }> = {
  pushups: { title: 'Push-Ups', subtitle: 'Rep fight! Most reps in 60s', icon: '💪', max_reps: 30, time: 60 },
  squats: { title: 'Squats', subtitle: 'Deep squat showdown', icon: '🦵', max_reps: 40, time: 60 },
  rapbattle: { title: 'Rap Battle', subtitle: '60s freestyle battle', icon: '🎤', max_reps: 0, time: 60 },
  symmetry: { title: 'Facial Symmetry', subtitle: 'Mirror face contest', icon: '📏', max_reps: 0, time: 30 },
  mog: { title: 'Mog', subtitle: 'Looksmaxx challenge', icon: '🎯', max_reps: 0, time: 30 },
  textchat: { title: 'Text Chat', subtitle: 'FFA up to 20 players', icon: '📱', max_reps: 20, time: 0 },
  ffa: { title: 'FFA', subtitle: 'Free-for-all time challenge', icon: '⏱️', max_reps: 20, time: 0 },
};

export function LobbyScreen({ navigation }: { navigation: any }) {
  const { state, startSearch, guest, logout } = useApp();
  const isSearching = state.isSearching;
  const [selectedMode, setSelectedMode] = useState<'chat' | 'competitive'>('chat');

  const handleQuickMatch = async (gameSlug: GameSlug) => {
    try {
      await startSearch(gameSlug);
    } catch (err: any) {
      Alert.alert('Matchmaking Error', err.message || 'Could not start match');
    }
  };

  const handleRooms = () => {
    navigation.navigate('Rooms');
  };

  const handleGuest = async () => {
    try {
      await guest();
    } catch (err: any) {
      Alert.alert('Guest mode unavailable', err.message || 'Could not create a guest session');
    }
  };

  // Don't render while loading auth
  if (state.auth.status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4f46e5" />
        <Text style={styles.loading}>Loading Trap Chat...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Trap Chat</Text>
        <Text style={styles.tagline}>Chat • Compete • Win</Text>
      </View>

      {/* Mode Selector */}
      <View style={styles.modeSelector}>
        <TouchableOpacity 
          style={[styles.modeBtn, selectedMode === 'chat' && styles.modeBtnActive]}
          onPress={() => setSelectedMode('chat')}
        >
          <Text style={[styles.modeText, selectedMode === 'chat' && styles.modeTextActive]}>Chat</Text>
          <Text style={styles.modeSubtext}>Make friends, video chat</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.modeBtn, selectedMode === 'competitive' && styles.modeBtnActive]}
          onPress={() => setSelectedMode('competitive')}
        >
          <Text style={[styles.modeText, selectedMode === 'competitive' && styles.modeTextActive]}>Competitive</Text>
          <Text style={styles.modeSubtext}>1v1 & FFA games</Text>
        </TouchableOpacity>
      </View>

      {/* Chat Mode Content */}
      {selectedMode === 'chat' && (
        <View style={styles.section}>
          <TouchableOpacity style={styles.bigCard} onPress={handleRooms}>
            <Text style={styles.cardIcon}>🚪</Text>
            <Text style={styles.cardTitle}>Rooms</Text>
            <Text style={styles.cardSubtitle}>Create a room or join one by code</Text>
            <Text style={styles.cardNote}>Tap to open rooms</Text>
          </TouchableOpacity>

          <Text style={styles.sectionLabel}>Quick Rooms</Text>
          <View style={styles.smallCards}>
            <TouchableOpacity style={styles.smallCard} onPress={handleRooms}>
              <Text style={styles.cardIcon}>👥</Text>
              <Text style={styles.cardTitle}>Browse</Text>
            </TouchableOpacity>
          </View>

          {/* Video chat is not built yet. Shown as unavailable rather than as a
              working control, so it is not mistaken for a finished feature. */}
          <View style={[styles.bigCard, styles.unavailable]}>
            <Text style={styles.cardIcon}>💬</Text>
            <Text style={styles.cardTitle}>Random Video Chat</Text>
            <Text style={styles.cardSubtitle}>Not available yet</Text>
          </View>
        </View>
      )}

      {/* Competitive Mode Content */}
      {selectedMode === 'competitive' && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>1v1 Games</Text>
          <View style={styles.cardGrid}>
            {GAME_MODES.filter(g => g !== 'textchat' && g !== 'ffa').map((game) => (
              <TouchableOpacity 
                key={game} 
                style={styles.gameCard}
                onPress={() => handleQuickMatch(game)}
                disabled={isSearching}
              >
                <Text style={styles.gameIcon}>{GAME_LABELS[game].icon}</Text>
                <Text style={styles.gameTitle}>{GAME_LABELS[game].title}</Text>
                <Text style={styles.gameSub}>{GAME_LABELS[game].subtitle}</Text>
                {isSearching && state.searchGame === game && (
                  <View style={styles.searchingIndicator}>
                    <ActivityIndicator size="small" color="#4f46e5" />
                    <Text style={styles.searchingText}>Waiting for opponent...</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionLabel}>FFA Games</Text>
          <View style={styles.cardGrid}>
            {GAME_MODES.filter(g => g === 'textchat' || g === 'ffa').map((game) => (
              <TouchableOpacity 
                key={game} 
                style={styles.gameCard}
                onPress={() => handleQuickMatch(game)}
                disabled={isSearching}
              >
                <Text style={styles.gameIcon}>{GAME_LABELS[game].icon}</Text>
                <Text style={styles.gameTitle}>{GAME_LABELS[game].title}</Text>
                <Text style={styles.gameSub}>{GAME_LABELS[game].subtitle}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
        <Text style={styles.footerNote}>
          {state.auth.status === 'guest' ? 'Guest mode - create account for leaderboards!' : ''}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  unavailable: { opacity: 0.4 },
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a0a0a' },
  loading: { marginTop: 10, color: '#888', fontSize: 14 },
  
  header: { alignItems: 'center', marginBottom: 30 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#fff', fontFamily: 'System', marginBottom: 4 },
  tagline: { color: '#888', fontSize: 14 },

  modeSelector: { flexDirection: 'row', marginBottom: 20, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 4 },
  modeBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 8 },
  modeBtnActive: { backgroundColor: '#4f46e5' },
  modeText: { color: '#888', fontSize: 16, fontWeight: '600' },
  modeTextActive: { color: '#fff' },
  modeSubtext: { fontSize: 10, color: '#666', marginTop: 4 },

  section: { marginTop: 10 },
  sectionLabel: { color: '#888', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },

  bigCard: { backgroundColor: '#1a1a1a', borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 16 },
  cardIcon: { fontSize: 32, marginBottom: 8 },
  cardTitle: { color: '#fff', fontSize: 20, fontWeight: '600', marginBottom: 4 },
  cardSubtitle: { color: '#888', fontSize: 14, textAlign: 'center', marginBottom: 8 },
  cardNote: { color: '#666', fontSize: 12, fontStyle: 'italic' },

  smallCards: { flexDirection: 'row', gap: 12 },
  smallCard: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, alignItems: 'center' },

  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gameCard: { flex: 1, minWidth: 140, backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16, alignItems: 'center' },
  gameIcon: { fontSize: 32, marginBottom: 8 },
  gameTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  gameSub: { color: '#888', fontSize: 11, textAlign: 'center' },
  
  searchingIndicator: { marginTop: 8, alignItems: 'center' },
  searchingText: { color: '#888', fontSize: 11, marginTop: 4 },

  footer: { marginTop: 30, alignItems: 'center' },
  logoutBtn: { backgroundColor: '#4f46e5', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  logoutText: { color: '#fff', fontWeight: '600' },
  footerNote: { color: '#666', fontSize: 12, marginTop: 12 },
});