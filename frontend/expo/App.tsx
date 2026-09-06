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
import { ModeProvider } from './src/hooks/useAccent';
import { Mode } from './src/theme';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';

// Which world each page belongs to. The accent follows this, so the app is
// violet while you are being social and lime while you are competing.
const PAGE_MODE: Record<PageName, Mode> = {
  Random: 'social',
  Browse: 'social',
  Competitive: 'competitive',
  Leaderboards: 'competitive',
  Profile: 'social',
};

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
  const category = match
    ? state.games.find((g) => g.slug === match.game?.slug)?.category
    : undefined;
  // Only a competitive match takes the screen over, and only then does the
  // game decide the colour. A social match renders inside its page, so while
  // you sit in a chat and read the leaderboard the app is still the colour of
  // the page you are looking at.
  const mode: Mode =
    match && category === 'competitive' ? 'competitive' : PAGE_MODE[page];

  if (match) {
    if (category === 'competitive') {
      // Each competitive game is scored differently, so each gets the screen
      // that can score it. Push-ups and squats are counted from the camera,
      // a rap battle is timed against a beat and then put to the room, and
      // Looks Battle still has no scoring of its own.
      const slug = match.game?.slug ?? '';
      const screen = EXERCISES[slug] ? (
        <RankedMatchScreen />
      ) : slug === 'rapbattle' ? (
        <RapBattleScreen />
      ) : (
        <MatchScreen />
      );
      return <ModeProvider mode={mode}>{screen}</ModeProvider>;
    }
  }

  return (
    <ModeProvider mode={mode}>
      <ScreenFrame title={TITLES[page]} active={page} onNavigate={setPage}>
      {page === 'Random' && <SocialScreen />}
      {page === 'Browse' && <BrowseScreen onEntered={() => setPage('Random')} />}
      {page === 'Competitive' && <CompetitiveScreen />}
      {page === 'Leaderboards' && <LeaderboardScreen />}
      {page === 'Profile' && <ProfileScreen />}
      </ScreenFrame>
    </ModeProvider>
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
