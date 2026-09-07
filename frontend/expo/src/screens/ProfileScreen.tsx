// Trap Chat — Profile & settings
// Who you are, what Random should look for, and the way out.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useApp } from '../context/AppContext';

function Toggle({
  label,
  blurb,
  value,
  onChange,
}: {
  label: string;
  blurb: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <TouchableOpacity
      style={styles.toggle}
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleBlurb}>{blurb}</Text>
      </View>
      <View style={[styles.switch, value && styles.switchOn]}>
        {/* Black on lime: white on it is unreadable. */}
        <Text style={[styles.switchText, value && styles.switchTextOn]}>{value ? 'On' : 'Off'}</Text>
      </View>
    </TouchableOpacity>
  );
}

export function ProfileScreen() {
  const { state, setSocialMode, setVideoOn, setProfanityFilter, logout } = useApp();

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

      {/* SETTINGS */}
      <Text style={styles.section}>SETTINGS</Text>
      <Toggle
        label="Profanity filter"
        blurb="Mask swearing in messages. This only changes what you see."
        value={state.profanityFilter}
        onChange={setProfanityFilter}
      />
      <Toggle
        label="Video"
        blurb="Use the camera in social rooms, groups included. Turn it off for text only."
        value={state.videoOn}
        onChange={setVideoOn}
      />

      {/* THE WAY OUT */}
      <Text style={styles.section}>ACCOUNT</Text>
      <TouchableOpacity style={styles.signOut} onPress={logout}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  content: { padding: 18, paddingBottom: 44 },
  card: { backgroundColor: '#121212', borderRadius: 8, padding: 18 },
  label: { color: '#a1a1a1', fontSize: 10, letterSpacing: 1.5, fontWeight: '700' },
  name: { color: '#fff', fontSize: 22, fontWeight: '900', marginTop: 6 },
  kind: { color: '#7B5CFF', fontSize: 12, fontWeight: '700', marginTop: 3 },
  rating: { color: '#a1a1a1', fontSize: 13, marginTop: 8 },
  toggle: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#121212', borderRadius: 8, padding: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', marginBottom: 8,
  },
  toggleLabel: { color: '#ffffff', fontWeight: '700', fontSize: 15 },
  toggleBlurb: { color: '#a1a1a1', fontSize: 11, marginTop: 3, lineHeight: 16 },
  switch: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
    backgroundColor: '#1f1f1f', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    minWidth: 58, alignItems: 'center',
  },
  switchOn: { backgroundColor: '#CCFF00', borderColor: '#CCFF00' },
  switchText: { color: '#ffffff', fontWeight: '800', fontSize: 12 },
  switchTextOn: { color: '#000000' },
  notice: { backgroundColor: '#1f1f1f', borderRadius: 8, padding: 14, marginTop: 12 },
  noticeText: { color: '#a1a1a1', fontSize: 12, lineHeight: 18 },
  section: { color: '#a1a1a1', fontSize: 10, letterSpacing: 1.5, fontWeight: '700', marginTop: 22, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 10 },
  choice: { flex: 1, backgroundColor: '#121212', borderRadius: 8, padding: 16 },
  choiceActive: { backgroundColor: '#7B5CFF' },
  choiceText: { color: '#ffffff', fontWeight: '800', fontSize: 16 },
  choiceTextActive: { color: '#fff' },
  choiceBlurb: { color: '#a1a1a1', fontSize: 11, marginTop: 4 },
  signOut: { backgroundColor: '#1f1f1f', borderRadius: 8, paddingVertical: 15, alignItems: 'center' },
  signOutText: { color: '#7B5CFF', fontWeight: '800' },
});
