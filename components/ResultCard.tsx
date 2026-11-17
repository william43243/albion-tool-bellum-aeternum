import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE, FONT_WEIGHT } from '../constants/theme';

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

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>

      {highlight && (
        <View style={styles.highlightBox}>
          <Text style={styles.highlightLabel}>{highlight.label}</Text>
          <View style={styles.highlightNumber}>
            <Text style={[styles.highlightValue, { color: highlight.value === 0 ? COLORS.text : highlightColor }]}>
              {highlight.value > 0 ? '+' : ''}{formatSilver(highlight.value)}
            </Text>
            <Text style={styles.highlightUnit}>silver</Text>
          </View>
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
    backgroundColor: COLORS.card,
    padding: SPACING.md,
    marginVertical: SPACING.sm,
    borderTopWidth: 2,
    borderTopColor: COLORS.text,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontWeight: FONT_WEIGHT.bold,
    marginBottom: SPACING.sm,
  },
  highlightBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    columnGap: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderStrong,
    paddingBottom: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  highlightLabel: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: FONT_WEIGHT.semibold,
  },
  highlightNumber: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginLeft: 'auto',
  },
  highlightValue: {
    fontSize: FONT_SIZE.title,
    fontWeight: FONT_WEIGHT.heavy,
    fontVariant: ['tabular-nums'],
  },
  highlightUnit: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  rowLabel: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.md,
  },
  rowValue: {
    maxWidth: '50%',
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
    fontWeight: FONT_WEIGHT.medium,
  },
  boldText: {
    fontWeight: FONT_WEIGHT.bold,
    color: COLORS.text,
  },
});
