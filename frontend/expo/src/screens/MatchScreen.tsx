// Trap Chat — Match Screen
// Shown whenever there is an active match. Displays the shareable room code,
// who is present, and a live chat relayed over Socket.IO.

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useApp } from '../context/AppContext';
import api from '../services/api';

interface ChatLine {
  id: string;
  from: string;
  text: string;
  system?: boolean;
}

export function MatchScreen() {
  const { state, forfeit } = useApp();
  const match = state.currentMatch;
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState('');
  const scroller = useRef<ScrollView | null>(null);

  const me =
    state.auth.status === 'authenticated'
      ? state.auth.user.username
      : state.auth.status === 'guest'
      ? state.auth.session.display_name
      : 'You';

  useEffect(() => {
    if (!match) return;

    const add = (line: Omit<ChatLine, 'id'>) =>
      setLines((prev) => [...prev, { ...line, id: `${Date.now()}-${Math.random()}` }]);

    const offChat = api.onChatMessage(({ from, text }) => add({ from, text }));
    const offJoined = api.onPlayerJoined(({ player }) =>
      add({ from: 'system', text: `${player.display_name} joined`, system: true }),
    );
    const offLeft = api.onPlayerLeft(() =>
      add({ from: 'system', text: 'A player left', system: true }),
    );
    const offError = api.onError(({ message }) =>
      add({ from: 'system', text: `Error: ${message}`, system: true }),
    );
    const offFinished = api.onMatchFinished((data) => {
      const outcome = (data as { outcome?: string }).outcome;
      add({
        from: 'system',
        text: outcome === 'stalemate'
          ? 'Match ended in a stalemate: the other player disconnected.'
          : 'Match finished.',
        system: true,
      });
    });

    // The context already joins the socket room when the match is entered.
    // Joining again here would make the server emit a second player_joined to
    // everyone, so the other player sees "X joined" twice.

    return () => {
      offChat();
      offJoined();
      offLeft();
      offError();
      offFinished();
    };
  }, [match?.id]);

  if (!match) return null;

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    api.sendChatMessage(match.id, text);
    // The server does not echo to the sender, so show it locally.
    setLines((prev) => [...prev, { id: `${Date.now()}`, from: me, text }]);
    setDraft('');
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.gameName}>{match.game?.name ?? 'Match'}</Text>
          <Text style={styles.sub}>Ranked 1v1</Text>
        </View>
        <TouchableOpacity onPress={forfeit} style={styles.leaveBtn}>
          <Text style={styles.leaveText}>Forfeit</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.codeBox}>
        <Text style={styles.codeLabel}>RANKED MATCH</Text>
        <Text style={styles.code} selectable>
          {match.room_code}
        </Text>
        <Text style={styles.codeNote}>
          Play it out. Leaving early forfeits, and a disconnect is a stalemate.
        </Text>
      </View>

      <ScrollView
        ref={scroller}
        style={styles.chat}
        contentContainerStyle={styles.chatContent}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
      >
        {lines.length === 0 ? (
          <Text style={styles.empty}>No messages yet. Say something.</Text>
        ) : (
          lines.map((line) => (
            <View key={line.id} style={styles.line}>
              {line.system ? (
                <Text style={styles.system}>{line.text}</Text>
              ) : (
                <Text style={styles.message}>
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
        <TouchableOpacity onPress={send} style={styles.sendBtn}>
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f19', paddingTop: 52 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 },
  gameName: { color: '#fff', fontSize: 22, fontWeight: '700' },
  sub: { color: '#9ca3af', fontSize: 13, marginTop: 2 },
  leaveBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1f2937' },
  leaveText: { color: '#f87171', fontWeight: '600' },
  codeBox: {
    marginHorizontal: 20,
    marginBottom: 14,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#111827',
    alignItems: 'center',
  },
  codeLabel: { color: '#6b7280', fontSize: 11, letterSpacing: 1.5, marginBottom: 4 },
  codeNote: { color: '#6b7280', fontSize: 11, marginTop: 8, textAlign: 'center', lineHeight: 15 },
  code: { color: '#818cf8', fontSize: 28, fontWeight: '800', letterSpacing: 3 },
  chat: { flex: 1, marginHorizontal: 20 },
  chatContent: { paddingBottom: 12 },
  empty: { color: '#6b7280', fontStyle: 'italic', marginTop: 12 },
  line: { marginBottom: 8 },
  message: { color: '#e5e7eb', fontSize: 15 },
  from: { color: '#818cf8', fontWeight: '700' },
  system: { color: '#6b7280', fontSize: 13, fontStyle: 'italic' },
  composer: { flexDirection: 'row', padding: 16, gap: 10, borderTopWidth: 1, borderTopColor: '#1f2937' },
  input: {
    flex: 1,
    backgroundColor: '#111827',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  sendBtn: { backgroundColor: '#6366f1', borderRadius: 10, paddingHorizontal: 20, justifyContent: 'center' },
  sendText: { color: '#fff', fontWeight: '700' },
});
