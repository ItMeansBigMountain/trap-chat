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
import { RankedMatchScreen } from './src/screens/RankedMatchScreen';
import { RapBattleScreen } from './src/screens/RapBattleScreen';
import { EXERCISES } from './src/services/repCounter';
import { ScreenFrame, PageName } from './src/components/ScreenFrame';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';

const TITLES: Record<PageName, string> = {
  'For You': 'For You',
  Browse: 'Browse',
  Competitive: 'Competitive',
  Leaderboards: 'Leaderboards',
  Profile: 'Profile',
};

function AppShell() {
  const { state } = useApp();
  const [page, setPage] = useState<PageName>('For You');

  if (state.auth.status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#FE2C55" size="large" />
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
      // Each competitive game is scored differently, so each gets the screen
      // that can score it. Push-ups and squats are counted from the camera,
      // a rap battle is timed against a beat and then put to the room, and
      // Looks Battle still has no scoring of its own.
      const slug = match.game?.slug ?? '';
      if (EXERCISES[slug]) return <RankedMatchScreen />;
      if (slug === 'rapbattle') return <RapBattleScreen />;
      return <MatchScreen />;
    }
  }

  return (
    <ScreenFrame title={TITLES[page]} active={page} onNavigate={setPage}>
      {page === 'For You' && <SocialScreen />}
      {page === 'Browse' && <BrowseScreen onEntered={() => setPage('For You')} />}
      {page === 'Competitive' && <CompetitiveScreen />}
      {page === 'Leaderboards' && <LeaderboardScreen />}
      {page === 'Profile' && <ProfileScreen />}
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
  loading: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#a1a1aa', marginTop: 12 },
});
