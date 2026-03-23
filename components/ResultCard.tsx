import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';

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
  const highlightColor = highlight
    ? highlight.value >= 0
      ? COLORS.profit
      : COLORS.loss
    : undefined;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>

      {highlight && (
        <View style={[styles.highlightBox, { borderColor: highlightColor }]}>
          <Text style={styles.highlightLabel}>{highlight.label}</Text>
          <Text style={[styles.highlightValue, { color: highlightColor }]}>
            {formatSilver(highlight.value)} silver
          </Text>
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
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginVertical: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  title: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    marginBottom: SPACING.md,
  },
  highlightBox: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 4,
    alignItems: 'center',
  },
  highlightLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
    marginBottom: SPACING.xs,
  },
  highlightValue: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '800',
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
