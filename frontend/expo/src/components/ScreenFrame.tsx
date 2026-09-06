// Trap Chat — Screen Frame
// One nav structure, rendered two ways: a fixed left sidebar on the web, and
// the same list behind a hamburger on a phone.
//
// Social is a group you open to reach Random and Browse, rather than five flat
// destinations. Those two are the same activity picked two ways, and burying
// them together says so; Competitive and Leaderboards are not.

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Pressable,
  ScrollView,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { useLayout } from '../hooks/useLayout';
import { useAccent } from '../hooks/useAccent';
import { Wordmark } from './Icon';
import { T } from '../theme';

const DRAWER_WIDTH = 310;

export type PageName = 'Random' | 'Browse' | 'Competitive' | 'Leaderboards' | 'Profile';

export function ScreenFrame({
  title,
  active,
  onNavigate,
  children,
}: {
  title: string;
  active: PageName;
  onNavigate: (page: PageName) => void;
  children: React.ReactNode;
}) {
  const { isWide } = useLayout();
  const { accent, ink } = useAccent();
  const { state, setSocialMode, leaveMatch } = useApp();
  const [open, setOpen] = useState(false);
  const [socialOpen, setSocialOpen] = useState(true);
  const slide = useRef(new Animated.Value(-DRAWER_WIDTH)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: open ? 0 : -DRAWER_WIDTH,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [open, slide]);

  // Resizing up to the sidebar layout must not strand the drawer open on top
  // of the sidebar that has just replaced it.
  useEffect(() => {
    if (isWide) setOpen(false);
  }, [isWide]);

  const who =
    state.auth.status === 'authenticated'
      ? state.auth.user.username
      : state.auth.status === 'guest'
      ? state.auth.session.display_name
      : '';

  const go = (page: PageName) => {
    setOpen(false);
    onNavigate(page);
  };

  // The nav itself, identical in both layouts.
  const nav = (
    <>
      <TouchableOpacity style={styles.group} onPress={() => setSocialOpen((v) => !v)}>
        <Text style={styles.groupIcon}>💬</Text>
        <Text style={styles.groupText}>Social</Text>
        <Text style={styles.chevron}>{socialOpen ? '▾' : '▸'}</Text>
      </TouchableOpacity>

      {socialOpen && (
        <View style={styles.sub}>
          <TouchableOpacity
            style={[styles.link, active === 'Random' && styles.linkActive]}
            onPress={() => go('Random')}
            accessibilityLabel="Random"
          >
            <Text style={[styles.linkText, active === 'Random' && { color: accent }]}>
              Random
            </Text>
            <Text style={styles.linkBlurb}>Swipe for the next person</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.link, active === 'Browse' && styles.linkActive]}
            onPress={() => go('Browse')}
            accessibilityLabel="Browse"
          >
            <Text style={[styles.linkText, active === 'Browse' && { color: accent }]}>
              Browse
            </Text>
            <Text style={styles.linkBlurb}>All open rooms, or join by code</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity
        style={[styles.group, active === 'Competitive' && styles.linkActive]}
        onPress={() => go('Competitive')}
        accessibilityLabel="Competitive"
      >
        <Text style={styles.groupIcon}>🏆</Text>
        <Text style={[styles.groupText, active === 'Competitive' && { color: accent }]}>
          Competitive
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.group, active === 'Leaderboards' && styles.linkActive]}
        onPress={() => go('Leaderboards')}
        accessibilityLabel="Leaderboards"
      >
        <Text style={styles.groupIcon}>📊</Text>
        <Text style={[styles.groupText, active === 'Leaderboards' && { color: accent }]}>
          Leaderboards
        </Text>
      </TouchableOpacity>
    </>
  );

  const roomPanel = (
    <RoomPanel
      accent={accent}
      ink={ink}
      state={state}
      setSocialMode={setSocialMode}
      onLeave={() => {
        setOpen(false);
        leaveMatch();
      }}
    />
  );

  const profileRow = (
    <TouchableOpacity
      style={[styles.group, active === 'Profile' && styles.linkActive]}
      onPress={() => go('Profile')}
      accessibilityLabel="Profile"
    >
      <Text style={styles.groupIcon}>⚙️</Text>
      <Text style={[styles.groupText, active === 'Profile' && { color: accent }]}>
        Profile & settings
      </Text>
    </TouchableOpacity>
  );

  // ---------- WIDE: SIDEBAR BESIDE THE PAGE ----------
  if (isWide) {
    return (
      <View style={styles.wideRoot}>
        <View style={styles.sidebar}>
          <ScrollView
            contentContainerStyle={styles.sidebarInner}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.sidebarBrand}>
              <Wordmark size={25} />
            </View>

            {who ? (
              <View style={styles.sidebarWho}>
                <View style={styles.sidebarAvatar}>
                  <Text style={styles.sidebarAvatarText}>{who.charAt(0).toUpperCase()}</Text>
                </View>
                <Text style={styles.sidebarWhoText} numberOfLines={1}>
                  {who}
                </Text>
              </View>
            ) : null}

            {nav}

            <View style={styles.sidebarPanel}>{roomPanel}</View>

            <View style={styles.sidebarFooter}>
              <Text style={styles.footerLink}>Trap Chat</Text>
              <Text style={styles.footerLink}>Terms & Privacy</Text>
              <Text style={styles.footerCopy}>© 2026 Trap Chat</Text>
            </View>
          </ScrollView>

          <View style={styles.sidebarBottom}>{profileRow}</View>
        </View>

        <View style={styles.wideBody}>{children}</View>
      </View>
    );
  }

  // ---------- NARROW: HAMBURGER AND DRAWER ----------
  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => setOpen(true)}
          style={styles.burger}
          accessibilityLabel="Open menu"
        >
          <View style={styles.burgerBar} />
          <View style={styles.burgerBar} />
          <View style={styles.burgerBar} />
        </TouchableOpacity>
        <View style={styles.topCentre}>
          <Text style={styles.topTitle}>{title}</Text>
          {/* Who this tab is. Two tabs of one browser share a login, and
              seeing the same name in both is the only obvious tell. */}
          {who ? <Text style={styles.topWho}>{who}</Text> : null}
        </View>
        <View style={styles.burger} />
      </View>

      <View style={styles.body}>{children}</View>

      {open && (
        <Pressable
          accessibilityLabel="Close menu"
          style={styles.backdrop}
          onPress={() => setOpen(false)}
        />
      )}

      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[styles.drawer, { transform: [{ translateX: slide }] }]}
      >
        <ScrollView contentContainerStyle={styles.drawerScroll} showsVerticalScrollIndicator={false}>
          <Wordmark size={23} />
          {who ? <Text style={styles.drawerWho}>{who}</Text> : null}
          {roomPanel}
          <View style={styles.drawerNav}>{nav}</View>
        </ScrollView>
        <View style={styles.drawerFooter}>{profileRow}</View>
      </Animated.View>
    </View>
  );
}

// Shared by both layouts: where you are, what you want next, and the way out.
function RoomPanel({
  accent,
  ink,
  state,
  setSocialMode,
  onLeave,
}: {
  accent: string;
  ink: string;
  state: ReturnType<typeof useApp>['state'];
  setSocialMode: ReturnType<typeof useApp>['setSocialMode'];
  onLeave: () => void;
}) {
  const match = state.currentMatch;
  return (
    <View>
      {match ? (
        <View style={styles.nowCard}>
          <Text style={styles.nowLabel}>IN THIS ROOM</Text>
          <Text style={styles.nowName}>{match.game?.name ?? 'Room'}</Text>
          <Text style={[styles.nowCode, { color: accent }]}>#{match.room_code}</Text>
          <TouchableOpacity style={styles.leaveRoom} onPress={onLeave}>
            <Text style={[styles.leaveRoomText, { color: accent }]}>Leave room</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.nowCard}>
          <Text style={styles.nowLabel}>NOT IN A ROOM</Text>
          <Text style={styles.nowIdle}>Pick Random or Browse.</Text>
        </View>
      )}

      <Text style={styles.prefLabel}>MATCH ME WITH</Text>
      <View style={styles.prefRow}>
        {(
          [
            { key: 'chat1v1' as const, label: '1:1' },
            { key: 'groupchat' as const, label: 'Groups' },
          ]
        ).map((option) => (
          <TouchableOpacity
            key={option.key}
            style={[
              styles.pref,
              state.socialMode === option.key && { backgroundColor: accent, borderColor: accent },
            ]}
            onPress={() => setSocialMode(option.key)}
          >
            <Text
              style={[styles.prefText, state.socialMode === option.key && { color: ink }]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },

  // WIDE
  wideRoot: { flex: 1, flexDirection: 'row', backgroundColor: T.bg },
  sidebar: {
    width: T.sidebarWidth,
    flexGrow: 0,
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: T.border,
    backgroundColor: T.bg,
  },
  sidebarInner: { paddingHorizontal: 14, paddingTop: 18, paddingBottom: 20 },
  sidebarBrand: { paddingHorizontal: 6, marginBottom: 18 },
  sidebarWho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 6,
    marginBottom: 14,
  },
  sidebarAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: T.surfaceHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarAvatarText: { color: T.text, fontWeight: '800', fontSize: 13 },
  sidebarWhoText: { color: T.text, fontWeight: '600', fontSize: 14, flex: 1 },
  sidebarPanel: { marginTop: 18, borderTopWidth: 1, borderTopColor: T.border, paddingTop: 16 },
  sidebarFooter: {
    marginTop: 22,
    borderTopWidth: 1,
    borderTopColor: T.border,
    paddingTop: 14,
    gap: 6,
  },
  sidebarBottom: {
    borderTopWidth: 1,
    borderTopColor: T.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  footerLink: { color: T.textDim, fontSize: 12, fontWeight: '600' },
  footerCopy: { color: T.textFaint, fontSize: 11, marginTop: 4 },
  wideBody: { flex: 1 },

  // NARROW
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 44,
    paddingBottom: 8,
    paddingHorizontal: 12,
    backgroundColor: T.bg,
  },
  burger: { width: 30, height: 22, justifyContent: 'space-between', paddingVertical: 3 },
  burgerBar: { height: 2, borderRadius: 2, backgroundColor: T.text },
  topCentre: { flex: 1, alignItems: 'center' },
  topTitle: { color: T.text, fontSize: 16, fontWeight: '700' },
  topWho: { color: T.textDim, fontSize: 11, marginTop: 1 },
  body: { flex: 1 },

  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    zIndex: 8,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: DRAWER_WIDTH,
    backgroundColor: T.surface,
    paddingTop: 52,
    zIndex: 9,
    borderRightWidth: 1,
    borderRightColor: T.border,
  },
  drawerScroll: { paddingHorizontal: 18, paddingBottom: 20 },
  drawerWho: { color: T.textDim, fontSize: 13, marginTop: 6, fontWeight: '600' },
  drawerNav: { marginTop: 14, borderTopWidth: 1, borderTopColor: T.border, paddingTop: 10 },
  drawerFooter: {
    borderTopWidth: 1,
    borderTopColor: T.border,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 26,
  },

  // NAV
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: T.radius,
    marginTop: 4,
  },
  groupIcon: { fontSize: 18 },
  groupText: { color: T.text, fontSize: 16, fontWeight: '700', flex: 1 },
  chevron: { color: T.textDim, fontSize: 13 },
  sub: { paddingLeft: 14 },
  link: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: T.radius },
  linkActive: { backgroundColor: T.surfaceHi },
  linkText: { color: T.text, fontSize: 15, fontWeight: '600' },
  linkTextActive: { color: T.accent },
  linkBlurb: { color: T.textDim, fontSize: 11, marginTop: 2 },

  // ROOM PANEL
  nowCard: {
    backgroundColor: T.surface,
    borderRadius: T.radius,
    padding: 13,
    marginTop: 14,
    borderWidth: 1,
    borderColor: T.border,
  },
  nowLabel: { color: T.textDim, fontSize: 10, letterSpacing: 1.4, fontWeight: '700' },
  nowName: { color: T.text, fontSize: 15, fontWeight: '700', marginTop: 5 },
  nowCode: { color: T.accent, fontSize: 12, letterSpacing: 2, marginTop: 2, fontWeight: '700' },
  nowIdle: { color: T.textDim, fontSize: 12, marginTop: 5 },
  leaveRoom: {
    marginTop: 11,
    paddingVertical: 9,
    borderRadius: T.radius,
    backgroundColor: T.surfaceHi,
    alignItems: 'center',
  },
  leaveRoomText: { color: T.accent, fontWeight: '700', fontSize: 13 },
  prefLabel: {
    color: T.textDim,
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: '700',
    marginTop: 16,
  },
  prefRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  pref: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: T.radius,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
  },
  prefActive: { backgroundColor: T.accent, borderColor: T.accent },
  prefText: { color: T.textDim, fontWeight: '700', fontSize: 13 },
  prefTextActive: { color: T.text },
});
