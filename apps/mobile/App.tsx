/**
 * Kerala Tourism - Mobile Application Root
 *
 * Configured with:
 * - AuthProvider (in-memory access tokens, SecureStore refresh tokens, single-flight mutex)
 * - BookingProvider (active hold state, live 15-minute countdown, idempotency key persistence)
 * - NavigationProvider & AppNavigator (typed screen router)
 */

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { THEME_COLORS } from '@kerala-tourism/constants';
import { AuthProvider } from './src/context/AuthContext';
import { BookingProvider } from './src/context/BookingContext';
import { NotificationProvider } from './src/context/NotificationContext';
import { AppNavigator } from './src/navigation/AppNavigator';
import { NavigationProvider } from './src/navigation/NavigationContext';

export default function App() {
  return (
    <AuthProvider>
      <BookingProvider>
        <NotificationProvider>
          <NavigationProvider initialRoute="Explore">
            <StatusBar style="light" backgroundColor={THEME_COLORS.FOREST_GREEN} />
            <AppNavigator />
          </NavigationProvider>
        </NotificationProvider>
      </BookingProvider>
    </AuthProvider>
  );
}
