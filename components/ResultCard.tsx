import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS, SHADOWS, FONT_WEIGHT } from '../constants/theme';

interface ResultRow {
  label: string;
  value: string | number;
  color?: string;
  bold?: boolean;
}

interface Props {
  title: string;
  rows: ResultRow[];
  highlight?: { value: number; label: string };
}

function formatSilver(value: number): string {
  if (Math.abs(value) >= 1000000) {
    return (value / 1000000).toFixed(2) + 'M';
  }
  if (Math.abs(value) >= 1000) {
    return (value / 1000).toFixed(1) + 'k';
  }
  return Math.round(value).toLocaleString();
}

export default function ResultCard({ title, rows, highlight }: Props) {
  const isPositive = highlight ? highlight.value >= 0 : true;
  const highlightColor = highlight
    ? isPositive
      ? COLORS.profit
      : COLORS.loss
    : undefined;
  const highlightBg = isPositive ? COLORS.profitBg : COLORS.lossBg;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>

      {highlight && (
        <View
          style={[
            styles.highlightBox,
            { borderColor: highlightColor, backgroundColor: highlightBg },
          ]}
        >
          <View style={styles.highlightHeader}>
            <View style={[styles.badge, { backgroundColor: highlightColor + '26', borderColor: highlightColor + '55' }]}>
              <Text style={[styles.badgeArrow, { color: highlightColor }]}>
                {isPositive ? '▲' : '▼'}
              </Text>
              <Text style={[styles.badgeText, { color: highlightColor }]}>
                {highlight.label}
              </Text>
            </View>
          </View>
          <Text style={[styles.highlightValue, { color: highlightColor }]}>
            {formatSilver(highlight.value)}
          </Text>
          <Text style={styles.highlightUnit}>silver</Text>
        </View>
      )}

      {rows.map((row, index) => (
        <View key={index} style={styles.row}>
          <Text style={[styles.rowLabel, row.bold && styles.boldText]}>
            {row.label}
          </Text>
          <Text
            style={[
              styles.rowValue,
              row.bold && styles.boldText,
              row.color ? { color: row.color } : null,
            ]}
          >
            {typeof row.value === 'number' ? formatSilver(row.value) : row.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.cardElevated,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginVertical: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.borderGold,
    ...SHADOWS.md,
  },
  title: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.lg,
    fontWeight: FONT_WEIGHT.bold,
    marginBottom: SPACING.md,
    letterSpacing: 0.3,
  },
  highlightBox: {
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  highlightHeader: {
    marginBottom: SPACING.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: BORDER_RADIUS.pill,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.xs - 1,
  },
  badgeArrow: {
    fontSize: FONT_SIZE.xs,
    marginRight: SPACING.xs,
  },
  badgeText: {
    fontSize: FONT_SIZE.xs,
    fontWeight: FONT_WEIGHT.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  highlightValue: {
    fontSize: FONT_SIZE.hero,
    fontWeight: FONT_WEIGHT.heavy,
    letterSpacing: -0.5,
  },
  highlightUnit: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border + '40',
  },
  rowLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.md,
  },
  rowValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '500',
  },
  boldText: {
    fontWeight: '700',
    color: COLORS.text,
  },
});
