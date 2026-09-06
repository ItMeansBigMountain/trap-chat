// Trap Chat — Icons
// Icons drawn from characters so nothing is fetched at runtime. Nothing stops
// us loading an icon font -- there is no CSP on the deployment -- but one that
// fails to load leaves a page of tofu boxes, and these cost no request.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ACCENTS, T } from '../theme';

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

// The wordmark. The offset chromatic split this used to have was TikTok's
// logo treatment, which is the single most derivative thing the app had.
// Instead the name carries the two modes: Trap is the competitive lime, Chat
// is the social violet, so the logo states what the product is.
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <View style={styles.mark}>
      <Text style={[styles.markTrap, { fontSize: size }]}>Trap</Text>
      <Text style={[styles.markChat, { fontSize: size }]}>Chat</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  glyph: { textAlign: 'center' },
  mark: { flexDirection: 'row', alignItems: 'center' },
  markTrap: { color: ACCENTS.competitive, fontWeight: '900', letterSpacing: -0.8 },
  markChat: { color: ACCENTS.social, fontWeight: '900', letterSpacing: -0.8 },
});
