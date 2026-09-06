// Trap Chat — Profile & settings
// Who you are, what Random should look for, and the way out.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useApp } from '../context/AppContext';

export function ProfileScreen() {
  const { state, setSocialMode, logout } = useApp();

  const isGuest = state.auth.status === 'guest';
  const name =
    state.auth.status === 'authenticated'
      ? state.auth.user.username
      : state.auth.status === 'guest'
      ? state.auth.session.display_name
      : '';
  const rating = state.auth.status === 'authenticated' ? state.auth.user.rating : null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* WHO YOU ARE */}
      <View style={styles.card}>
        <Text style={styles.label}>SIGNED IN AS</Text>
        <Text style={styles.name}>{name || 'Unknown'}</Text>
        <Text style={styles.kind}>{isGuest ? 'Guest' : 'Account'}</Text>
        {rating != null && <Text style={styles.rating}>Rating {rating}</Text>}
      </View>

      {isGuest && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Guests are not ranked. Make an account to keep a rating and appear on
            the leaderboards.
          </Text>
        </View>
      )}

      {/* WHAT RANDOM SHOULD FIND */}
      <Text style={styles.section}>MATCH ME WITH</Text>
      <View style={styles.row}>
        {(
          [
            { key: 'chat1v1' as const, label: '1:1', blurb: 'One person at a time' },
            { key: 'groupchat' as const, label: 'Groups', blurb: 'Drop into a crowd' },
          ]
        ).map((option) => (
          <TouchableOpacity
            key={option.key}
            style={[styles.choice, state.socialMode === option.key && styles.choiceActive]}
            onPress={() => setSocialMode(option.key)}
          >
            <Text style={[styles.choiceText, state.socialMode === option.key && styles.choiceTextActive]}>
              {option.label}
            </Text>
            <Text style={styles.choiceBlurb}>{option.blurb}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* THE WAY OUT */}
      <Text style={styles.section}>ACCOUNT</Text>
      <TouchableOpacity style={styles.signOut} onPress={logout}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#08090d' },
  content: { padding: 18, paddingBottom: 44 },
  card: { backgroundColor: '#12151c', borderRadius: 16, padding: 18 },
  label: { color: '#6b7280', fontSize: 10, letterSpacing: 1.5, fontWeight: '700' },
  name: { color: '#fff', fontSize: 22, fontWeight: '900', marginTop: 6 },
  kind: { color: '#818cf8', fontSize: 12, fontWeight: '700', marginTop: 3 },
  rating: { color: '#9ca3af', fontSize: 13, marginTop: 8 },
  notice: { backgroundColor: '#161b24', borderRadius: 12, padding: 14, marginTop: 12 },
  noticeText: { color: '#9ca3af', fontSize: 12, lineHeight: 18 },
  section: { color: '#6b7280', fontSize: 10, letterSpacing: 1.5, fontWeight: '700', marginTop: 22, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 10 },
  choice: { flex: 1, backgroundColor: '#12151c', borderRadius: 14, padding: 16 },
  choiceActive: { backgroundColor: '#4f46e5' },
  choiceText: { color: '#d1d5db', fontWeight: '800', fontSize: 16 },
  choiceTextActive: { color: '#fff' },
  choiceBlurb: { color: '#6b7280', fontSize: 11, marginTop: 4 },
  signOut: { backgroundColor: '#171b24', borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  signOutText: { color: '#f87171', fontWeight: '800' },
});
