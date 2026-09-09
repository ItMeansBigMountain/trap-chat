// Trap Chat — Profile & settings
// Who you are, what Random should look for, and the way out.

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { useApp } from '../context/AppContext';
import api from '../services/api';

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

/**
 * Changing a password, ending other sessions, and deleting the account.
 *
 * Everything here needs the current password, and that is the point rather
 * than friction for its own sake. A signed token lasts 30 days; somebody who
 * picks one up off a shared computer should not be able to change the
 * password with it, because that turns a leak into a theft. Deleting cannot
 * be undone, so it asks for the same.
 */
function Security({ onSignedOut }: { onSignedOut: () => void }) {
  const [open, setOpen] = useState<'password' | 'delete' | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const reset = () => {
    setCurrent('');
    setNext('');
    setError(null);
  };

  const run = async (work: () => Promise<void>, success?: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await work();
      reset();
      setOpen(null);
      if (success) setDone(success);
    } catch (err: any) {
      setError(err?.message ?? 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Text style={styles.section}>SECURITY</Text>

      {done ? <Text style={styles.done}>{done}</Text> : null}

      {open === 'password' ? (
        <View style={styles.panel}>
          <TextInput
            style={styles.input}
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            placeholder="Current password"
            placeholderTextColor="#71717a"
            accessibilityLabel="Current password"
          />
          <TextInput
            style={styles.input}
            value={next}
            onChangeText={setNext}
            secureTextEntry
            placeholder="New password (8+ characters)"
            placeholderTextColor="#71717a"
            accessibilityLabel="New password"
          />
          <Text style={styles.panelNote}>
            This signs you out everywhere else, which is the point of changing it.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.panelRow}>
            <TouchableOpacity
              style={[styles.primary, busy && styles.disabled]}
              disabled={busy}
              onPress={() => run(() => api.changePassword(current, next), 'Password changed.')}
              accessibilityLabel="Save new password"
            >
              {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryText}>Save</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { reset(); setOpen(null); }} accessibilityLabel="Cancel">
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : open === 'delete' ? (
        <View style={styles.panel}>
          <Text style={styles.dangerLead}>
            This deletes your account, your rating and your leaderboard places. It
            cannot be undone. Matches you played stay, without your name on them.
          </Text>
          <TextInput
            style={styles.input}
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            placeholder="Your password"
            placeholderTextColor="#71717a"
            accessibilityLabel="Password to delete account"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.panelRow}>
            <TouchableOpacity
              style={[styles.danger, busy && styles.disabled]}
              disabled={busy}
              onPress={() => run(async () => {
                await api.deleteAccount(current);
                onSignedOut();
              })}
              accessibilityLabel="Delete my account"
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.dangerText}>Delete my account</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { reset(); setOpen(null); }} accessibilityLabel="Cancel">
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
          <TouchableOpacity
            style={styles.rowAction}
            onPress={() => { reset(); setOpen('password'); }}
            accessibilityLabel="Change password"
          >
            <Text style={styles.rowActionText}>Change password</Text>
            <Text style={styles.rowActionHint}>Ends every other session</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.rowAction, busy && styles.disabled]}
            disabled={busy}
            onPress={() => run(() => api.signOutEverywhere(), 'Signed out on every other device.')}
            accessibilityLabel="Sign out everywhere else"
          >
            <Text style={styles.rowActionText}>Sign out everywhere else</Text>
            <Text style={styles.rowActionHint}>
              For a device you no longer have. This one stays signed in.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.rowAction}
            onPress={() => { reset(); setOpen('delete'); }}
            accessibilityLabel="Delete account"
          >
            <Text style={[styles.rowActionText, styles.dangerLabel]}>Delete account</Text>
            <Text style={styles.rowActionHint}>Permanent. Your matches stay, anonymised.</Text>
          </TouchableOpacity>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </>
      )}
    </>
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

      {/* SECURITY, WHICH ONLY AN ACCOUNT HAS */}
      {!isGuest && <Security onSignedOut={logout} />}

      {/* THE WAY OUT */}
      <Text style={styles.section}>ACCOUNT</Text>
      <TouchableOpacity style={styles.signOut} onPress={logout} accessibilityLabel="Sign out">
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
  panel: { backgroundColor: '#121212', borderRadius: 8, padding: 14, gap: 10 },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 2 },
  panelNote: { color: '#a1a1a1', fontSize: 11, lineHeight: 16 },
  input: {
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#fff',
    fontSize: 14,
  },
  primary: { backgroundColor: '#CCFF00', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 26, minHeight: 44, justifyContent: 'center' },
  primaryText: { color: '#000', fontWeight: '900', fontSize: 14 },
  danger: { backgroundColor: '#FF4757', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20, minHeight: 44, justifyContent: 'center' },
  dangerText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  dangerLabel: { color: '#FF4757' },
  dangerLead: { color: '#a1a1a1', fontSize: 12, lineHeight: 18 },
  cancelText: { color: '#a1a1a1', fontWeight: '700', fontSize: 13 },
  rowAction: { backgroundColor: '#121212', borderRadius: 8, padding: 14, marginBottom: 8 },
  rowActionText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  rowActionHint: { color: '#a1a1a1', fontSize: 11, marginTop: 3, lineHeight: 15 },
  error: { color: '#FF4757', fontSize: 12, marginTop: 4 },
  done: { color: '#CCFF00', fontSize: 12, marginBottom: 10, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  signOut: { backgroundColor: '#1f1f1f', borderRadius: 8, paddingVertical: 15, alignItems: 'center' },
  signOutText: { color: '#7B5CFF', fontWeight: '800' },
});
