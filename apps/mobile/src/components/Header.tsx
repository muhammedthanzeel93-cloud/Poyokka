/**
 * Standard Mobile Screen Top Bar / Header Component
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { THEME_COLORS } from '@kerala-tourism/constants';
import { useAppNavigation } from '../navigation/NavigationContext';

interface HeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  rightActionText?: string;
  onRightAction?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  showBack = true,
  rightActionText,
  onRightAction,
}) => {
  const { goBack, canGoBack } = useAppNavigation();

  return (
    <View style={styles.container}>
      <View style={styles.leftContainer}>
        {showBack && canGoBack() ? (
          <TouchableOpacity
            style={styles.backButton}
            onPress={goBack}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Text style={styles.backArrow}>←</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.placeholder} />
        )}
      </View>

      <View style={styles.titleContainer}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={styles.rightContainer}>
        {rightActionText && onRightAction ? (
          <TouchableOpacity onPress={onRightAction} style={styles.rightButton}>
            <Text style={styles.rightActionText}>{rightActionText}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.placeholder} />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: THEME_COLORS.FOREST_GREEN,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  leftContainer: {
    width: 44,
    alignItems: 'flex-start',
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightContainer: {
    width: 44,
    alignItems: 'flex-end',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  backArrow: {
    fontSize: 22,
    color: THEME_COLORS.WHITE,
    fontWeight: '700',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME_COLORS.WHITE,
  },
  subtitle: {
    fontSize: 11,
    color: '#D1FAE5',
    marginTop: 2,
  },
  placeholder: {
    width: 40,
  },
  rightButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  rightActionText: {
    fontSize: 13,
    color: THEME_COLORS.SUNSET_ORANGE,
    fontWeight: '700',
  },
});
