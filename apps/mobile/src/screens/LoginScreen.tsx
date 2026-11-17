/**
 * Tourist Mobile Authentication Screen
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { THEME_COLORS } from '@kerala-tourism/constants';
import { Header } from '../components/Header';
import { useAuth } from '../context/AuthContext';
import { useAppNavigation } from '../navigation/NavigationContext';
import { RootScreenName } from '../navigation/types';

interface LoginScreenProps {
  returnScreen?: RootScreenName;
  returnParams?: any;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ returnScreen, returnParams }) => {
  const { navigate, goBack } = useAppNavigation();
  const { login } = useAuth();

  const [email, setEmail] = useState<string>('tourist@example.com');
  const [password, setPassword] = useState<string>('StrongP@ssw0rd!');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please enter both email and password');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await login(email.trim().toLowerCase(), password);

      if (returnScreen) {
        navigate(returnScreen, returnParams);
      } else {
        goBack();
      }
    } catch (err: any) {
      setError(err?.message || 'Login failed. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Header title="Tourist Sign In" />

      <View style={styles.content}>
        <View style={styles.brandBadge}>
          <Text style={styles.brandIcon}>🌴</Text>
        </View>

        <Text style={styles.title}>Welcome to Kerala Tourism</Text>
        <Text style={styles.subtitle}>
          Sign in to complete your property reservation and access verified booking passes.
        </Text>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput
              style={styles.input}
              placeholder="tourist@example.com"
              placeholderTextColor="#94A3B8"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="#94A3B8"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          <TouchableOpacity
            style={[styles.loginBtn, loading ? styles.loginBtnDisabled : null]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={THEME_COLORS.WHITE} />
            ) : (
              <Text style={styles.loginBtnText}>Sign In & Continue</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F7F1',
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  brandIcon: {
    fontSize: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: THEME_COLORS.CHARCOAL,
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 24,
    maxWidth: 300,
  },
  errorBox: {
    width: '100%',
    backgroundColor: '#FEE2E2',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: THEME_COLORS.ERROR_RED,
  },
  errorText: {
    fontSize: 13,
    color: THEME_COLORS.ERROR_RED,
    fontWeight: '600',
    textAlign: 'center',
  },
  form: {
    width: '100%',
    backgroundColor: THEME_COLORS.WHITE,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: THEME_COLORS.MUTED_BORDER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: THEME_COLORS.CHARCOAL,
    backgroundColor: '#FAFAF9',
  },
  loginBtn: {
    backgroundColor: THEME_COLORS.FOREST_GREEN,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  loginBtnDisabled: {
    opacity: 0.6,
  },
  loginBtnText: {
    color: THEME_COLORS.WHITE,
    fontWeight: '700',
    fontSize: 15,
  },
});
