// Trap Chat — Icons
// Icons drawn from characters so nothing is fetched at runtime. Nothing stops
// us loading an icon font -- there is no CSP on the deployment -- but one that
// fails to load leaves a page of tofu boxes, and these cost no request.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { T } from '../theme';

export type IconName =
  | 'home' | 'search' | 'compass' | 'users' | 'live' | 'plus'
  | 'user' | 'dots' | 'trophy' | 'chart' | 'heart' | 'comment'
  | 'bookmark' | 'share' | 'music' | 'chevronUp' | 'chevronDown' | 'close';

// TikTok's rail is glyph-led. These are the closest single characters that
// render identically across platforms without a webfont.
const GLYPHS: Record<IconName, string> = {
  home: '⌂',
  search: '⌕',
  compass: '◎',
  users: '⚇',
  live: '▣',
  plus: '＋',
  user: '⚈',
  dots: '⋯',
  trophy: '♛',
  chart: '▤',
  heart: '♥',
  comment: '💬',
  bookmark: '🔖',
  share: '➤',
  music: '♪',
  chevronUp: '⌃',
  chevronDown: '⌄',
  close: '✕',
};

export function Icon({
  name,
  size = 22,
  color = T.text,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return (
    <Text
      allowFontScaling={false}
      style={[styles.glyph, { fontSize: size, color, lineHeight: size * 1.15 }]}
    >
      {GLYPHS[name]}
    </Text>
  );
}

// The wordmark, with TikTok's cyan/red chromatic split behind it.
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <View style={styles.mark}>
      {/* The offset copies are the colour fringe, not words. Hidden from
          assistive tech so the name is not read out three times. */}
      <Text
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[styles.markCyan, { fontSize: size, left: -1.5 }]}
      >
        Trap
      </Text>
      <Text
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[styles.markRed, { fontSize: size, left: 1.5 }]}
      >
        Trap
      </Text>
      <Text style={[styles.markText, { fontSize: size }]}>Trap</Text>
      <Text style={[styles.markThin, { fontSize: size }]}>Chat</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  glyph: { textAlign: 'center' },
  mark: { flexDirection: 'row', alignItems: 'center' },
  markText: { color: T.text, fontWeight: '900', letterSpacing: -0.5 },
  markThin: { color: T.text, fontWeight: '300', letterSpacing: -0.5 },
  markCyan: { position: 'absolute', color: T.accentCyan, fontWeight: '900', letterSpacing: -0.5 },
  markRed: { position: 'absolute', color: T.accent, fontWeight: '900', letterSpacing: -0.5 },
});
