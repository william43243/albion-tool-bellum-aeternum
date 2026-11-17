import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';

interface Props {
  isPremium: boolean;
  onToggle: (value: boolean) => void;
  labelOn?: string;
  labelOff?: string;
}

export default function PremiumToggle({
  isPremium,
  onToggle,
  labelOn = 'Premium',
  labelOff = 'Non-Premium',
}: Props) {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.option, !isPremium && styles.activeOption]}
        accessibilityRole="radio"
        accessibilityState={{ checked: !isPremium }}
        onPress={() => onToggle(false)}
      >
        <Text style={[styles.optionText, !isPremium && styles.activeText]}>
          {labelOff}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.option, isPremium && styles.premiumActive]}
        accessibilityRole="radio"
        accessibilityState={{ checked: isPremium }}
        onPress={() => onToggle(true)}
      >
        <Text style={[styles.optionText, isPremium && styles.premiumText]}>
          {labelOn}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: 3,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  option: {
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    borderRadius: BORDER_RADIUS.sm,
  },
  activeOption: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  premiumActive: {
    backgroundColor: COLORS.primaryFaint,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  optionText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    fontWeight: '500',
  },
  activeText: {
    color: COLORS.text,
    fontWeight: '600',
  },
  premiumText: {
    color: COLORS.primary,
    fontWeight: '700',
  },
});
