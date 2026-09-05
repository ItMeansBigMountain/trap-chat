import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AppProvider, useApp } from './src/context/AppContext';
import { LobbyScreen } from './src/screens/LobbyScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';

const Stack = createNativeStackNavigator();

function AppNavigator() {
  const { state } = useApp();
  if (state.auth.status === 'loading') {
    return <View style={styles.loading}><ActivityIndicator color="#6366f1" size="large" /><Text style={styles.loadingText}>Loading Trap Chat…</Text></View>;
  }
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {state.auth.status === 'unauthenticated' ? (
        <Stack.Screen name="Auth" component={AuthScreen} />
      ) : (
        <Stack.Screen name="Lobby" component={LobbyScreen} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AppProvider>
      <NavigationContainer theme={DarkTheme}><AppNavigator /></NavigationContainer>
    </AppProvider>
  );
}

const styles = StyleSheet.create({ loading: { flex: 1, backgroundColor: '#09090b', justifyContent: 'center', alignItems: 'center' }, loadingText: { color: '#a1a1aa', marginTop: 12 } },);
  
  // Deployment smoke-test screen is intentionally replaced by the real lobby above.
  