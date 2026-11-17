/**
 * Tourist Authentication React Context
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { authService, TouristAccount } from '../services/auth.service';

export interface AuthContextValue {
  user: TouristAccount | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login(email: string, password: string): Promise<TouristAccount>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<TouristAccount | null>(authService.getCurrentAccount());
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(authService.isAuthenticated());
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    // Subscribe to auth state updates
    const unsubscribe = authService.addListener((isAuth, account) => {
      setIsAuthenticated(isAuth);
      setUser(account);
    });

    // Initialize session from secure storage
    authService
      .initialize()
      .then((isAuth) => {
        setIsAuthenticated(isAuth);
        setUser(authService.getCurrentAccount());
      })
      .finally(() => {
        setIsLoading(false);
      });

    return unsubscribe;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const account = await authService.login(email, password);
      setUser(account);
      setIsAuthenticated(true);
      return account;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await authService.logout();
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated,
      isLoading,
      login,
      logout,
    }),
    [user, isAuthenticated, isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
