import React, { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useApp } from '../context/AppContext';

export function AuthScreen() {
  const { login, register, guest } = useApp();
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      if (mode === 'register') {
        await register(username.trim(), email.trim() || undefined, password);
      } else {
        await login(username.trim(), password);
      }
    } catch (error) {
      Alert.alert(mode === 'register' ? 'Create account failed' : 'Sign in failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const enterAsGuest = async () => {
    setSubmitting(true);
    try {
      await guest();
    } catch (error) {
      Alert.alert('Guest mode unavailable', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Trap Chat</Text>
        <Text style={styles.subtitle}>{mode === 'register' ? 'Create an account to save scores and play ranked matches.' : 'Welcome back.'}</Text>
        <TextInput accessibilityLabel="Username" autoCapitalize="none" autoCorrect={false} editable={!submitting} onChangeText={setUsername} placeholder="Username" placeholderTextColor="#71717a" style={styles.input} value={username} />
        {mode === 'register' && <TextInput accessibilityLabel="Email (optional)" autoCapitalize="none" autoCorrect={false} editable={!submitting} keyboardType="email-address" onChangeText={setEmail} placeholder="Email (optional)" placeholderTextColor="#71717a" style={styles.input} value={email} />}
        <TextInput accessibilityLabel="Password" editable={!submitting} onChangeText={setPassword} placeholder="Password (8+ characters)" placeholderTextColor="#71717a" secureTextEntry style={styles.input} value={password} />
        <TouchableOpacity accessibilityRole="button" disabled={submitting} onPress={submit} style={[styles.primary, submitting && styles.disabled]}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{mode === 'register' ? 'Create account' : 'Sign in'}</Text>}
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" disabled={submitting} onPress={() => setMode(mode === 'register' ? 'login' : 'register')} style={styles.link}>
          <Text style={styles.linkText}>{mode === 'register' ? 'Already have an account? Sign in' : 'Need an account? Create one'}</Text>
        </TouchableOpacity>
        <View style={styles.divider}><View style={styles.dividerLine} /><Text style={styles.dividerText}>OR</Text><View style={styles.dividerLine} /></View>
        <TouchableOpacity accessibilityRole="button" disabled={submitting} onPress={enterAsGuest} style={styles.secondary}>
          <Text style={styles.secondaryText}>Continue as guest</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', backgroundColor: '#09090b', flex: 1, justifyContent: 'center', padding: 24 },
  card: { maxWidth: 420, width: '100%' }, title: { color: '#fff', fontSize: 36, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: '#a1a1aa', fontSize: 15, lineHeight: 22, marginBottom: 24, marginTop: 8, textAlign: 'center' },
  input: { backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: 10, borderWidth: 1, color: '#fff', fontSize: 16, marginBottom: 12, padding: 14 },
  primary: { alignItems: 'center', backgroundColor: '#4f46e5', borderRadius: 10, minHeight: 50, justifyContent: 'center', marginTop: 4 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' }, disabled: { opacity: 0.65 },
  link: { alignItems: 'center', padding: 16 }, linkText: { color: '#a5b4fc', fontSize: 14 },
  divider: { alignItems: 'center', flexDirection: 'row', gap: 10, marginBottom: 16 }, dividerLine: { backgroundColor: '#3f3f46', flex: 1, height: 1 }, dividerText: { color: '#71717a', fontSize: 12 },
  secondary: { alignItems: 'center', borderColor: '#52525b', borderRadius: 10, borderWidth: 1, minHeight: 50, justifyContent: 'center' }, secondaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
