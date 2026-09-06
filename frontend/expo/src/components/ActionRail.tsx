// Trap Chat — Action rail
// The vertical column of round buttons down the right of the feed, which is
// the single most recognisable piece of TikTok's chrome. Counts sit under the
// glyph, the avatar carries a red follow badge, and the whole thing overlays
// the video rather than taking layout space away from it.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Icon, IconName } from './Icon';
import { T } from '../theme';

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

export interface RailAction {
  key: string;
  icon: IconName;
  count?: number;
  label: string;
  active?: boolean;
  onPress?: () => void;
}

export function ActionRail({
  actions,
  avatarLetter,
  onAvatarPress,
}: {
  actions: RailAction[];
  avatarLetter?: string;
  onAvatarPress?: () => void;
}) {
  return (
    <View style={styles.rail} pointerEvents="box-none">
      {avatarLetter ? (
        <TouchableOpacity
          style={styles.avatarWrap}
          onPress={onAvatarPress}
          accessibilityLabel="Opponent profile"
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{avatarLetter.toUpperCase()}</Text>
          </View>
          <View style={styles.followBadge}>
            <Text style={styles.followPlus}>+</Text>
          </View>
        </TouchableOpacity>
      ) : null}

      {actions.map((action) => (
        <TouchableOpacity
          key={action.key}
          style={styles.action}
          onPress={action.onPress}
          accessibilityLabel={action.label}
        >
          <Icon
            name={action.icon}
            size={30}
            color={action.active ? T.accent : T.text}
          />
          {action.count !== undefined ? (
            <Text style={styles.count}>{compact(action.count)}</Text>
          ) : null}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { alignItems: 'center', gap: T.railGap },
  avatarWrap: { alignItems: 'center', marginBottom: 6 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: T.surfaceHi,
    borderWidth: 1.5,
    borderColor: T.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: T.text, fontWeight: '800', fontSize: 18 },
  followBadge: {
    position: 'absolute',
    bottom: -9,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followPlus: { color: T.text, fontSize: 14, fontWeight: '800', lineHeight: 16 },
  action: { alignItems: 'center' },
  count: { color: T.text, fontSize: 12, fontWeight: '600', marginTop: 4 },
});
