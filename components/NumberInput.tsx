import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS, FONT_WEIGHT } from '../constants/theme';

interface Props {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  info?: string;
}

export default function NumberInput({ label, value, onChangeText, placeholder, info }: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.container}>
      <Text style={[styles.label, focused && styles.labelFocused]}>{label}</Text>
      <TextInput
        style={[styles.input, focused && styles.inputFocused]}
        value={value}
        onChangeText={(text) => {
          // Allow only numbers and dots
          const cleaned = text.replace(/[^0-9.]/g, '');
          onChangeText(cleaned);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="numeric"
        placeholder={placeholder || '0'}
        placeholderTextColor={COLORS.textMuted}
        selectionColor={COLORS.primary}
      />
      {info && <Text style={styles.info}>{info}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: SPACING.md,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
    marginBottom: SPACING.xs,
    fontWeight: FONT_WEIGHT.medium,
    letterSpacing: 0.2,
  },
  labelFocused: {
    color: COLORS.primaryLight,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 3,
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontWeight: FONT_WEIGHT.semibold,
  },
  inputFocused: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surface2,
  },
  info: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: SPACING.xs,
    fontStyle: 'italic',
  },
});
