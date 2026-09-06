// Trap Chat — Social
// A doomscroll replacement: one person at a time, full bleed, and a swipe up
// (or the Next button) drops you straight into another. Skipping is always one
// gesture away, which is what makes the loop work.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  PanResponder,
  Animated,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useApp } from '../context/AppContext';
import api from '../services/api';
import { GameSlug } from '../types';

interface Line {
  id: string;
  from: string;
  text: string;
  system?: boolean;
}

const SOCIAL_CHANNEL: GameSlug = 'textchat' as GameSlug;

export function SocialScreen() {
  const { state, enterSocial, leaveMatch } = useApp();
  const match = state.currentMatch;
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState('');
  const drag = useRef(new Animated.Value(0)).current;
  const scroller = useRef<ScrollView | null>(null);

  const me =
    state.auth.status === 'authenticated'
      ? state.auth.user.username
      : state.auth.status === 'guest'
      ? state.auth.session.display_name
      : 'You';

  const next = useCallback(async () => {
    setError(null);
    setLines([]);
    setConnecting(true);
    try {
      await enterSocial(SOCIAL_CHANNEL);
    } catch (err: any) {
      setError(err?.message ?? 'Could not find anyone right now');
    } finally {
      setConnecting(false);
      drag.setValue(0);
    }
  }, [enterSocial, drag]);

  // Swipe up to skip. A button does the same thing, because a swipe is
  // awkward with a mouse and this has to work in a desktop browser too.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy < -12 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        if (g.dy < 0) drag.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy < -110) {
          next();
        } else {
          Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    }),
  ).current;

  useEffect(() => {
    if (!match) return;
    const add = (line: Omit<Line, 'id'>) =>
      setLines((prev) => [...prev, { ...line, id: `${Date.now()}-${Math.random()}` }]);
    const offChat = api.onChatMessage(({ from, text }) => add({ from, text }));
    const offJoined = api.onPlayerJoined(({ player }) =>
      add({ from: 'system', text: `${player.display_name} joined`, system: true }),
    );
    const offLeft = api.onPlayerLeft(() =>
      add({ from: 'system', text: 'They left. Swipe up for someone new.', system: true }),
    );
    return () => {
      offChat();
      offJoined();
      offLeft();
    };
  }, [match?.id]);

  const send = () => {
    const text = draft.trim();
    if (!text || !match) return;
    api.sendChatMessage(match.id, text);
    setLines((prev) => [...prev, { id: `${Date.now()}`, from: me, text }]);
    setDraft('');
  };

  if (!match) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>💬</Text>
        <Text style={styles.emptyTitle}>Social</Text>
        <Text style={styles.emptyBody}>
          Drop into a channel with whoever is around. Swipe up any time to skip to
          someone new.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.cta} onPress={next} disabled={connecting}>
          {connecting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>Start</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Animated.View style={[styles.stage, { transform: [{ translateY: drag }] }]} {...pan.panHandlers}>
        <View style={styles.stageTop}>
          <Text style={styles.room}>#{match.room_code}</Text>
          <Text style={styles.hint}>Swipe up to skip</Text>
        </View>

        <ScrollView
          ref={scroller}
          style={styles.chat}
          contentContainerStyle={styles.chatContent}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        >
          {lines.length === 0 ? (
            <Text style={styles.placeholder}>You are connected. Say something.</Text>
          ) : (
            lines.map((line) => (
              <View key={line.id} style={styles.line}>
                {line.system ? (
                  <Text style={styles.system}>{line.text}</Text>
                ) : (
                  <Text style={styles.msg}>
                    <Text style={styles.from}>{line.from}: </Text>
                    {line.text}
                  </Text>
                )}
              </View>
            ))
          )}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor="#6b7280"
            onSubmitEditing={send}
            returnKeyType="send"
          />
          <TouchableOpacity onPress={send} style={styles.send}>
            <Text style={styles.sendText}>Send</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity onPress={leaveMatch} style={styles.leave}>
            <Text style={styles.leaveText}>Leave</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={next} style={styles.next} disabled={connecting}>
            {connecting ? <ActivityIndicator color="#fff" /> : <Text style={styles.nextText}>Next ↑</Text>}
          </TouchableOpacity>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#08090d' },
  stage: { flex: 1, paddingHorizontal: 18, paddingBottom: 18 },
  stageTop: { alignItems: 'center', paddingVertical: 10 },
  room: { color: '#818cf8', fontWeight: '800', letterSpacing: 2 },
  hint: { color: '#4b5563', fontSize: 11, marginTop: 3 },
  chat: { flex: 1 },
  chatContent: { paddingVertical: 10 },
  placeholder: { color: '#6b7280', fontStyle: 'italic' },
  line: { marginBottom: 8 },
  msg: { color: '#e5e7eb', fontSize: 15 },
  from: { color: '#818cf8', fontWeight: '700' },
  system: { color: '#6b7280', fontSize: 12, fontStyle: 'italic' },
  composer: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  input: { flex: 1, backgroundColor: '#12151c', color: '#fff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  send: { backgroundColor: '#6366f1', borderRadius: 12, paddingHorizontal: 20, justifyContent: 'center' },
  sendText: { color: '#fff', fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 12 },
  leave: { flex: 1, paddingVertical: 15, borderRadius: 14, backgroundColor: '#171b24', alignItems: 'center' },
  leaveText: { color: '#9ca3af', fontWeight: '700' },
  next: { flex: 2, paddingVertical: 15, borderRadius: 14, backgroundColor: '#6366f1', alignItems: 'center' },
  nextText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyIcon: { fontSize: 46 },
  emptyTitle: { color: '#fff', fontSize: 26, fontWeight: '900', marginTop: 12 },
  emptyBody: { color: '#9ca3af', textAlign: 'center', marginTop: 10, lineHeight: 20 },
  error: { color: '#f87171', marginTop: 14, textAlign: 'center' },
  cta: { marginTop: 26, backgroundColor: '#6366f1', paddingVertical: 16, paddingHorizontal: 54, borderRadius: 16 },
  ctaText: { color: '#fff', fontWeight: '900', fontSize: 17 },
});
