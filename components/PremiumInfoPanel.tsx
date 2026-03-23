import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';

interface Props {
  title: string;
  bonuses: string[];
}

export default function PremiumInfoPanel({ title, bonuses }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => setExpanded(!expanded)}
      activeOpacity={0.8}
    >
      <View style={styles.header}>
        <Text style={styles.crown}>👑</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.arrow}>{expanded ? '▲' : '▼'}</Text>
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
    backgroundColor: COLORS.premiumBg,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.premiumGold + '60',
    marginVertical: SPACING.sm,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
  },
  crown: {
    fontSize: FONT_SIZE.lg,
    marginRight: SPACING.sm,
  },
  title: {
    color: COLORS.premiumGold,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    flex: 1,
  },
  arrow: {
    color: COLORS.premiumGold,
    fontSize: FONT_SIZE.sm,
  },
  body: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  bonusRow: {
    flexDirection: 'row',
    marginBottom: SPACING.xs,
  },
  bullet: {
    color: COLORS.premiumGold,
    marginRight: SPACING.sm,
    fontSize: FONT_SIZE.md,
  },
  bonusText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.sm,
    flex: 1,
  },
});
