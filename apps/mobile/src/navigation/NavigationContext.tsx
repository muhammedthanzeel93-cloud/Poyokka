/**
 * High-Performance Typed Navigation Context
 *
 * Implements a lightweight, zero-native-dependency navigation stack
 * designed for Expo managed workflow, Expo Go, and automated testing.
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { NavigationRoute, RootScreenName, ScreenParamsMap } from './types';

export interface NavigationContextValue {
  currentRoute: NavigationRoute;
  stack: NavigationRoute[];
  navigate<T extends RootScreenName>(name: T, params?: ScreenParamsMap[T]): void;
  replace<T extends RootScreenName>(name: T, params?: ScreenParamsMap[T]): void;
  goBack(): void;
  reset(name: RootScreenName, params?: any): void;
  canGoBack(): boolean;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export const NavigationProvider: React.FC<{
  initialRoute?: RootScreenName;
  initialParams?: any;
  children: React.ReactNode;
}> = ({ initialRoute = 'Explore', initialParams, children }) => {
  const [stack, setStack] = useState<NavigationRoute[]>([
    { name: initialRoute, params: initialParams },
  ]);

  const currentRoute = stack[stack.length - 1];

  const navigate = useCallback(<T extends RootScreenName>(name: T, params?: ScreenParamsMap[T]) => {
    setStack((prev) => [...prev, { name, params }]);
  }, []);

  const replace = useCallback(<T extends RootScreenName>(name: T, params?: ScreenParamsMap[T]) => {
    setStack((prev) => {
      const next = [...prev];
      next[next.length - 1] = { name, params };
      return next;
    });
  }, []);

  const goBack = useCallback(() => {
    setStack((prev) => {
      if (prev.length <= 1) return prev;
      return prev.slice(0, prev.length - 1);
    });
  }, []);

  const reset = useCallback((name: RootScreenName, params?: any) => {
    setStack([{ name, params }]);
  }, []);

  const canGoBack = useCallback(() => stack.length > 1, [stack.length]);

  const value = useMemo(
    () => ({
      currentRoute,
      stack,
      navigate,
      replace,
      goBack,
      reset,
      canGoBack,
    }),
    [currentRoute, stack, navigate, replace, goBack, reset, canGoBack],
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
};

export const useAppNavigation = (): NavigationContextValue => {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useAppNavigation must be used within a NavigationProvider');
  }
  return context;
};
