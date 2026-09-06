import 'react-native-gesture-handler';
import React, { useState } from 'react';
import { AppProvider, useApp } from './src/context/AppContext';
import { AuthScreen } from './src/screens/AuthScreen';
import { SocialScreen } from './src/screens/SocialScreen';
import { BrowseScreen } from './src/screens/BrowseScreen';
import { CompetitiveScreen } from './src/screens/CompetitiveScreen';
import { LeaderboardScreen } from './src/screens/LeaderboardScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { MatchScreen } from './src/screens/MatchScreen';
import { ScreenFrame, PageName } from './src/components/ScreenFrame';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';

const TITLES: Record<PageName, string> = {
  Random: 'Random',
  Browse: 'Browse',
  Competitive: 'Competitive',
  Leaderboards: 'Leaderboards',
  Profile: 'Profile',
};

function AppShell() {
  const { state } = useApp();
  const [page, setPage] = useState<PageName>('Random');

  if (state.auth.status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#6366f1" size="large" />
        <Text style={styles.loadingText}>Loading Trap Chat…</Text>
      </View>
    );
  }

  if (state.auth.status === 'unauthenticated') {
    return <AuthScreen />;
  }

  // A ranked match takes over the screen: competitive cannot be skipped away
  // from, only played out or forfeited. Social matches stay inside their page,
  // because skipping is the whole point there.
  const match = state.currentMatch;
  if (match) {
    const category = state.games.find((g) => g.slug === match.game?.slug)?.category;
    if (category === 'competitive') {
      return <MatchScreen />;
    }
  }

  // A social room opened from Browse is still a conversation, so show it.
  const activePage: PageName = match && page === 'Browse' ? 'Random' : page;

  return (
    <ScreenFrame title={TITLES[activePage]} active={activePage} onNavigate={setPage}>
      {activePage === 'Random' && <SocialScreen />}
      {activePage === 'Browse' && <BrowseScreen />}
      {activePage === 'Competitive' && <CompetitiveScreen />}
      {activePage === 'Leaderboards' && <LeaderboardScreen />}
      {activePage === 'Profile' && <ProfileScreen />}
    </ScreenFrame>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#08090d', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#a1a1aa', marginTop: 12 },
});
