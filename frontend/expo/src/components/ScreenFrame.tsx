// Trap Chat — Screen Frame
// Shared chrome for every page: a compact header with the hamburger, and the
// slide-in side nav. Built on core Animated rather than a drawer library so it
// behaves identically on web and native without another dependency.

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Pressable,
  Dimensions,
} from 'react-native';
import { useApp } from '../context/AppContext';

const DRAWER_WIDTH = Math.min(300, Dimensions.get('window').width * 0.82);

export type PageName = 'Social' | 'Competitive' | 'Leaderboards';

const PAGES: { name: PageName; icon: string; blurb: string }[] = [
  { name: 'Social', icon: '💬', blurb: 'Meet people, swipe for the next' },
  { name: 'Competitive', icon: '🏆', blurb: 'Ranked 1v1 matchmaking' },
  { name: 'Leaderboards', icon: '📊', blurb: 'Who is actually winning' },
];

export function ScreenFrame({
  title,
  active,
  onNavigate,
  children,
  transparentHeader = false,
}: {
  title: string;
  active: PageName;
  onNavigate: (page: PageName) => void;
  children: React.ReactNode;
  transparentHeader?: boolean;
}) {
  const { state, logout } = useApp();
  const [open, setOpen] = useState(false);
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

  return (
    <View style={styles.root}>
      <View style={[styles.header, transparentHeader && styles.headerTransparent]}>
        <TouchableOpacity
          onPress={() => setOpen(true)}
          style={styles.burger}
          accessibilityLabel="Open menu"
        >
          <View style={styles.burgerBar} />
          <View style={styles.burgerBar} />
          <View style={styles.burgerBar} />
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.body}>{children}</View>

      {open && <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />}

      <Animated.View style={[styles.drawer, { transform: [{ translateX: slide }] }]}>
        <Text style={styles.brand}>Trap Chat</Text>
        {who ? <Text style={styles.who}>{who}</Text> : null}

        <View style={styles.links}>
          {PAGES.map((page) => (
            <TouchableOpacity
              key={page.name}
              style={[styles.link, active === page.name && styles.linkActive]}
              onPress={() => go(page.name)}
            >
              <Text style={styles.linkIcon}>{page.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.linkText, active === page.name && styles.linkTextActive]}>
                  {page.name}
                </Text>
                <Text style={styles.linkBlurb}>{page.blurb}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.drawerFooter}>
          <TouchableOpacity onPress={logout} style={styles.signOut}>
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
          {state.auth.status === 'guest' && (
            <Text style={styles.guestNote}>
              You are a guest. Make an account to keep your rank.
            </Text>
          )}
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
  headerTransparent: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5, backgroundColor: 'transparent' },
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
    paddingTop: 58,
    paddingHorizontal: 18,
    zIndex: 9,
    borderRightWidth: 1,
    borderRightColor: '#1f2430',
  },
  brand: { color: '#fff', fontSize: 24, fontWeight: '900' },
  who: { color: '#818cf8', fontSize: 13, marginTop: 4, fontWeight: '600' },
  links: { marginTop: 26, gap: 6 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12 },
  linkActive: { backgroundColor: '#1b2030' },
  linkIcon: { fontSize: 20 },
  linkText: { color: '#e5e7eb', fontSize: 16, fontWeight: '700' },
  linkTextActive: { color: '#a5b4fc' },
  linkBlurb: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  drawerFooter: { marginTop: 'auto', paddingBottom: 34 },
  signOut: { paddingVertical: 12, alignItems: 'center', borderRadius: 10, backgroundColor: '#1b2030' },
  signOutText: { color: '#f87171', fontWeight: '700' },
  guestNote: { color: '#6b7280', fontSize: 11, marginTop: 10, textAlign: 'center', lineHeight: 15 },
});
