import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
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
import { MogOffScreen } from './src/screens/MogOffScreen';
import { ShadowBoxScreen } from './src/screens/ShadowBoxScreen';
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

  // A competitive match brings you to it. Without this the match would start
  // on a page you are not looking at, which is indistinguishable from nothing
  // happening.
  const liveCompetitive =
    state.currentMatch &&
    state.games.find((g) => g.slug === state.currentMatch?.game?.slug)?.category === 'competitive';
  useEffect(() => {
    if (liveCompetitive) setPage('Competitive');
  }, [liveCompetitive]);

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

  // Each competitive game is scored differently, so each gets the screen that
  // can score it.
  const slug = match?.game?.slug ?? '';
  const matchScreen =
    match && category === 'competitive' ? (
      EXERCISES[slug] ? (
        <RankedMatchScreen />
      ) : slug === 'shadowbox' ? (
        <ShadowBoxScreen />
      ) : slug === 'looks' ? (
        <MogOffScreen />
      ) : slug === 'rapbattle' ? (
        <RapBattleScreen />
      ) : (
        <MatchScreen />
      )
    ) : null;

  // A live match is shown on the Competitive page. It used to take the whole
  // screen over with no frame at all, which left no hamburger and no way out
  // except forfeiting; the nav is always there now, and the room card in it
  // is how you get back to a match you navigated away from.
  return (
    <ModeProvider mode={mode}>
      <ScreenFrame title={TITLES[page]} active={page} onNavigate={setPage}>
      {matchScreen && page === 'Competitive' ? matchScreen : null}
      {page === 'Random' && <SocialScreen />}
      {page === 'Browse' && <BrowseScreen onEntered={() => setPage('Random')} />}
      {page === 'Competitive' && !matchScreen && <CompetitiveScreen />}
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
