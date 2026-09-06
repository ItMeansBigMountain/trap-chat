// Trap Chat — Screen Frame
// Shared chrome: compact header with the hamburger, and the slide-in side nav.
// The nav also carries what you are in right now and what you want next, so
// those are one tap away instead of buried on a settings page.

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Pressable,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useApp } from '../context/AppContext';

const DRAWER_WIDTH = Math.min(310, Dimensions.get('window').width * 0.86);

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

  const match = state.currentMatch;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setOpen(true)} style={styles.burger} accessibilityLabel="Open menu">
          <View style={styles.burgerBar} />
          <View style={styles.burgerBar} />
          <View style={styles.burgerBar} />
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.headerSpacer} />
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
          <Text style={styles.brand}>Trap Chat</Text>
          {who ? <Text style={styles.who}>{who}</Text> : null}

          {/* WHERE YOU ARE RIGHT NOW */}
          {match ? (
            <View style={styles.nowCard}>
              <Text style={styles.nowLabel}>IN THIS ROOM</Text>
              <Text style={styles.nowName}>{match.game?.name ?? 'Room'}</Text>
              <Text style={styles.nowCode}>#{match.room_code}</Text>
              <TouchableOpacity
                style={styles.leaveRoom}
                onPress={() => {
                  setOpen(false);
                  leaveMatch();
                }}
              >
                <Text style={styles.leaveRoomText}>Leave room</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.nowCard}>
              <Text style={styles.nowLabel}>NOT IN A ROOM</Text>
              <Text style={styles.nowIdle}>Pick Random or Browse below.</Text>
            </View>
          )}

          {/* SOCIAL EXPANDS INTO RANDOM AND BROWSE */}
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
              >
                <Text style={[styles.linkText, active === 'Random' && styles.linkTextActive]}>Random</Text>
                <Text style={styles.linkBlurb}>Swipe for the next person</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.link, active === 'Browse' && styles.linkActive]}
                onPress={() => go('Browse')}
              >
                <Text style={[styles.linkText, active === 'Browse' && styles.linkTextActive]}>Browse</Text>
                <Text style={styles.linkBlurb}>All open rooms, or join by code</Text>
              </TouchableOpacity>

              {/* WHAT RANDOM SHOULD FIND NEXT */}
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
                    style={[styles.pref, state.socialMode === option.key && styles.prefActive]}
                    onPress={() => setSocialMode(option.key)}
                  >
                    <Text
                      style={[styles.prefText, state.socialMode === option.key && styles.prefTextActive]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[styles.group, active === 'Competitive' && styles.linkActive]}
            onPress={() => go('Competitive')}
          >
            <Text style={styles.groupIcon}>🏆</Text>
            <Text style={[styles.groupText, active === 'Competitive' && styles.linkTextActive]}>
              Competitive
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.group, active === 'Leaderboards' && styles.linkActive]}
            onPress={() => go('Leaderboards')}
          >
            <Text style={styles.groupIcon}>📊</Text>
            <Text style={[styles.groupText, active === 'Leaderboards' && styles.linkTextActive]}>
              Leaderboards
            </Text>
          </TouchableOpacity>
        </ScrollView>

        {/* PROFILE AND OPTIONS AT THE BOTTOM */}
        <View style={styles.drawerFooter}>
          <TouchableOpacity
            style={[styles.group, active === 'Profile' && styles.linkActive]}
            onPress={() => go('Profile')}
          >
            <Text style={styles.groupIcon}>⚙️</Text>
            <Text style={[styles.groupText, active === 'Profile' && styles.linkTextActive]}>
              Profile & settings
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#08090d' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 46,
    paddingBottom: 12,
    paddingHorizontal: 16,
    backgroundColor: '#08090d',
  },
  burger: { width: 34, height: 26, justifyContent: 'space-between', paddingVertical: 4 },
  burgerBar: { height: 2.5, borderRadius: 2, backgroundColor: '#f3f4f6' },
  title: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 18, fontWeight: '800' },
  headerSpacer: { width: 34 },
  body: { flex: 1 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 8 },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: DRAWER_WIDTH,
    backgroundColor: '#101318',
    paddingTop: 54,
    zIndex: 9,
    borderRightWidth: 1,
    borderRightColor: '#1f2430',
  },
  drawerScroll: { paddingHorizontal: 18, paddingBottom: 20 },
  brand: { color: '#fff', fontSize: 24, fontWeight: '900' },
  who: { color: '#818cf8', fontSize: 13, marginTop: 4, fontWeight: '600' },
  nowCard: { backgroundColor: '#161b24', borderRadius: 12, padding: 13, marginTop: 16, marginBottom: 6 },
  nowLabel: { color: '#6b7280', fontSize: 10, letterSpacing: 1.4, fontWeight: '700' },
  nowName: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 5 },
  nowCode: { color: '#818cf8', fontSize: 12, letterSpacing: 2, marginTop: 2, fontWeight: '700' },
  nowIdle: { color: '#6b7280', fontSize: 12, marginTop: 5 },
  leaveRoom: { marginTop: 11, paddingVertical: 9, borderRadius: 9, backgroundColor: '#1f2430', alignItems: 'center' },
  leaveRoomText: { color: '#f87171', fontWeight: '700', fontSize: 13 },
  group: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 12, borderRadius: 12, marginTop: 4 },
  groupIcon: { fontSize: 18 },
  groupText: { color: '#e5e7eb', fontSize: 16, fontWeight: '700', flex: 1 },
  chevron: { color: '#6b7280', fontSize: 13 },
  sub: { paddingLeft: 14 },
  link: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: 10 },
  linkActive: { backgroundColor: '#1b2030' },
  linkText: { color: '#d1d5db', fontSize: 15, fontWeight: '600' },
  linkTextActive: { color: '#a5b4fc' },
  linkBlurb: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  prefLabel: { color: '#6b7280', fontSize: 10, letterSpacing: 1.4, fontWeight: '700', marginTop: 14, marginLeft: 12 },
  prefRow: { flexDirection: 'row', gap: 8, marginTop: 8, marginLeft: 12 },
  pref: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: '#161b24' },
  prefActive: { backgroundColor: '#4f46e5' },
  prefText: { color: '#9ca3af', fontWeight: '700', fontSize: 13 },
  prefTextActive: { color: '#fff' },
  drawerFooter: { borderTopWidth: 1, borderTopColor: '#1f2430', paddingHorizontal: 18, paddingTop: 8, paddingBottom: 30 },
});
