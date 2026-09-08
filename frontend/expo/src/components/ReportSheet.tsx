// Trap Chat — Report and block
// The way out of a room with somebody you do not want to be in a room with.
//
// Two decisions shape this. It is one tap to open from the room itself, not
// buried in settings, because the moment somebody needs it is the moment they
// least want to go looking. And reporting always blocks: reporting a stranger
// you are on camera with is a request to get away from them, and making that
// a second separate action means it gets forgotten at exactly the wrong time.

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import api from '../services/api';
import { useAccent } from '../hooks/useAccent';
import { T } from '../theme';

const REASONS: { key: string; label: string }[] = [
  { key: 'nudity', label: 'Nudity or sexual content' },
  { key: 'harassment', label: 'Harassment or hate' },
  { key: 'underage', label: 'Looks under age' },
  { key: 'violence', label: 'Violence or threats' },
  { key: 'spam', label: 'Spam or advertising' },
  { key: 'other', label: 'Something else' },
];

export function ReportSheet({
  visible,
  matchId,
  playerId,
  displayName,
  onClose,
  onDone,
}: {
  visible: boolean;
  matchId: number;
  /** Null when nobody else has joined yet: there is nobody to report. */
  playerId: number | null;
  displayName: string | null;
  onClose: () => void;
  /** Called after a block or report, so the caller can leave the room. */
  onDone: () => void;
}) {
  const { accent, ink } = useAccent();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (run: () => Promise<unknown>) => {
    if (playerId == null) return;
    setBusy(true);
    setError(null);
    try {
      await run();
      onDone();
    } catch (err: any) {
      setError(err?.message ?? 'That did not go through');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>
            {displayName ? `Report ${displayName}` : 'Report'}
          </Text>
          <Text style={styles.lead}>
            Reporting also blocks, so you will not be matched with them again.
          </Text>

          {REASONS.map((reason) => (
            <TouchableOpacity
              key={reason.key}
              style={[styles.reason, busy && styles.disabled]}
              disabled={busy || playerId == null}
              onPress={() => act(() => api.reportPlayer(matchId, playerId as number, reason.key))}
              accessibilityLabel={reason.label}
            >
              <Text style={styles.reasonText}>{reason.label}</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={[styles.blockOnly, { borderColor: accent }, busy && styles.disabled]}
            disabled={busy || playerId == null}
            onPress={() => act(() => api.blockPlayer(matchId, playerId as number))}
            accessibilityLabel="Block without reporting"
          >
            <Text style={[styles.blockOnlyText, { color: accent }]}>
              Just block, do not report
            </Text>
          </TouchableOpacity>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity style={styles.cancel} onPress={onClose} accessibilityLabel="Cancel report">
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: T.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 34,
    borderTopWidth: 1,
    borderColor: T.border,
  },
  title: { color: T.text, fontSize: 19, fontWeight: '900' },
  lead: { color: T.textDim, fontSize: 12, lineHeight: 17, marginTop: 6, marginBottom: 14 },
  reason: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: T.radius,
    backgroundColor: T.surfaceHi,
    marginBottom: 8,
  },
  reasonText: { color: T.text, fontSize: 14, fontWeight: '600' },
  blockOnly: {
    marginTop: 6,
    paddingVertical: 13,
    borderRadius: T.radius,
    borderWidth: 1,
    alignItems: 'center',
  },
  blockOnlyText: { fontWeight: '800', fontSize: 14 },
  disabled: { opacity: 0.5 },
  error: { color: T.danger, fontSize: 12, marginTop: 10, textAlign: 'center' },
  cancel: { marginTop: 12, paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: T.textDim, fontWeight: '700', fontSize: 14 },
});
