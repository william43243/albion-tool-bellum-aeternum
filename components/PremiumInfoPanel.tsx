import BellumIcon from './BellumIcon';
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE } from '../constants/theme';

interface Props {
  title: string;
  bonuses: string[];
}

export default function PremiumInfoPanel({ title, bonuses }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <TouchableOpacity
      style={styles.container}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.8}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <View style={expanded && styles.expandedChevron}>
          <BellumIcon name="chevronDown" size={18} color={COLORS.textSecondary} />
        </View>
      </View>
      {expanded && (
        <View style={styles.body}>
          {bonuses.map((bonus, index) => (
            <View key={index} style={styles.bonusRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.bonusText}>{bonus}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: COLORS.borderStrong,
    marginVertical: SPACING.sm,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    minHeight: 48,
  },
  title: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    flex: 1,
  },
  expandedChevron: { transform: [{ rotate: '180deg' }] },
  body: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  bonusRow: {
    flexDirection: 'row',
    marginBottom: SPACING.xs,
  },
  bullet: {
    color: COLORS.textSecondary,
    marginRight: SPACING.sm,
    fontSize: FONT_SIZE.md,
  },
  bonusText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.sm,
    flex: 1,
  },
});
