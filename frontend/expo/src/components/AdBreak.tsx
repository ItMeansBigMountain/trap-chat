// Trap Chat — Ad Break
// The slot itself. Shown in the gap between matches, never during one.
//
// The skip is the important part. Forced exposure produces reactance -- anger
// rather than boredom -- and that persists until the viewer gets their sense
// of control back. A skip that arms after five seconds is what returns it,
// which is why every ad here has one, guests included.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SKIP_AFTER_MS, Viewer } from '../services/adPolicy';
import { useAccent } from '../hooks/useAccent';
import { T } from '../theme';

export function AdBreak({
  viewer,
  onDone,
  onCreateAccount,
}: {
  viewer: Viewer;
  onDone: () => void;
  /** Guests only: the pitch that makes the break worth something to them. */
  onCreateAccount?: () => void;
}) {
  const { accent, ink } = useAccent();
  const [msLeft, setMsLeft] = useState(SKIP_AFTER_MS);

  useEffect(() => {
    if (msLeft <= 0) return;
    const tick = setTimeout(() => setMsLeft((ms) => Math.max(0, ms - 250)), 250);
    return () => clearTimeout(tick);
  }, [msLeft]);

  const canSkip = msLeft <= 0;
  const seconds = Math.ceil(msLeft / 1000);

  return (
    <View style={styles.root}>
      <Text style={styles.label}>AD</Text>

      {/* No network is wired up yet, so this is the house ad. Choosing a
          network is a business decision and hard to reverse, and the slot is
          shaped so one can fill it without touching the policy. */}
      <View style={styles.creative}>
        <Text style={styles.creativeTitle}>Trap Chat</Text>
        <Text style={styles.creativeBody}>
          {viewer === 'guest'
            ? 'Make an account and see half as many of these. You also get a rating and a place on the leaderboard.'
            : 'Thanks for playing. Back to it in a moment.'}
        </Text>
      </View>

      {viewer === 'guest' && onCreateAccount ? (
        <TouchableOpacity
          style={[styles.pitch, { backgroundColor: accent }]}
          onPress={onCreateAccount}
        >
          <Text style={[styles.pitchText, { color: ink }]}>Make an account</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={[styles.skip, !canSkip && styles.skipWaiting]}
        onPress={canSkip ? onDone : undefined}
        disabled={!canSkip}
        accessibilityLabel={canSkip ? 'Skip ad' : `Skip available in ${seconds}s`}
      >
        <Text style={styles.skipText}>
          {canSkip ? 'Skip ›' : `Skip in ${seconds}`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: T.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 26,
    gap: 14,
  },
  label: { color: T.textFaint, fontSize: 10, letterSpacing: 2, fontWeight: '700' },
  creative: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: T.surface,
    borderRadius: T.radius,
    borderWidth: 1,
    borderColor: T.border,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  creativeTitle: { color: T.text, fontSize: 24, fontWeight: '900' },
  creativeBody: { color: T.textDim, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  pitch: { paddingVertical: 12, paddingHorizontal: 30, borderRadius: T.radius },
  pitchText: { fontWeight: '900', fontSize: 14 },
  skip: {
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: T.radiusPill,
    backgroundColor: T.surfaceHi,
    borderWidth: 1,
    borderColor: T.border,
    // Big enough to hit on any screen. A small or hidden exit is what turns
    // an ad from an interruption into a grievance.
    minWidth: 130,
    alignItems: 'center',
  },
  skipWaiting: { opacity: 0.55 },
  skipText: { color: T.text, fontWeight: '700', fontSize: 14 },
});
