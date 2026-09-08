// Trap Chat — What happens when a match ends
//
// Every competitive game ended with the same three lines of copy-pasted JSX
// and a single button labelled "Back to lobby" that quietly called forfeit.
// Two things were wrong with that. A match you had just won still made you go
// and find the game again to play another, which is the moment you are most
// likely to want one. And whoever forfeited never got here at all: conceding
// left the room, so the result was broadcast to a room they were no longer in
// and they were dropped back to the lobby with no idea what had happened.
//
// So: one panel, both players, two ways out. Playing again is the primary
// action because it is the one somebody who just finished a match actually
// wants.

import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAccent } from '../hooks/useAccent';
import { T } from '../theme';

export function MatchOutcome({
  outcome,
  onNext,
  onBack,
}: {
  /** What happened, in the player's own terms: "You win. They forfeited." */
  outcome: string | null;
  onNext: () => Promise<void> | void;
  onBack: () => void;
}) {
  const { accent, ink } = useAccent();
  const [queueing, setQueueing] = useState(false);

  const next = async () => {
    if (queueing) return;
    setQueueing(true);
    try {
      await onNext();
    } finally {
      setQueueing(false);
    }
  };

  return (
    <View style={styles.wrap} accessibilityLabel="Match over">
      <Text style={styles.headline}>{outcome ?? 'Match finished.'}</Text>

      <TouchableOpacity
        style={[styles.next, { backgroundColor: accent }, queueing && styles.busy]}
        onPress={next}
        disabled={queueing}
        accessibilityLabel="Find next match"
      >
        {queueing ? (
          <ActivityIndicator color={ink} />
        ) : (
          <Text style={[styles.nextText, { color: ink }]}>Find next match</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.back} onPress={onBack} accessibilityLabel="Back to game modes">
        <Text style={styles.backText}>Back to game modes</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    maxWidth: 460,
    marginTop: 14,
    alignItems: 'center',
    backgroundColor: T.surface,
    borderRadius: T.radius,
    borderWidth: 1,
    borderColor: T.border,
    padding: 18,
    gap: 10,
  },
  headline: {
    color: T.text,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 4,
  },
  next: {
    width: '100%',
    borderRadius: T.radius,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  nextText: { fontWeight: '900', fontSize: 15 },
  busy: { opacity: 0.7 },
  back: { paddingVertical: 10, paddingHorizontal: 16 },
  backText: { color: T.textDim, fontWeight: '700', fontSize: 13 },
});
