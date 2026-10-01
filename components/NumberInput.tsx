import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS, FONT_WEIGHT } from '../constants/theme';
import { parseUserNumber } from '../lib/numberParsing';
import { Language } from '../lib/i18n';

interface Props {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  info?: string;
  integer?: boolean;
  locale: Language;
}

export default function NumberInput({ label, value, onChangeText, placeholder, info, integer = false, locale }: Props) {
  const [focused, setFocused] = useState(false);
  const parsed = value ? parseUserNumber(value, integer, locale) : { valid: true, ambiguous: false };
  return (
    <View style={styles.container}>
      <Text style={[styles.label, focused && styles.labelFocused]}>{label}</Text>
      <TextInput
        style={[styles.input, focused && styles.inputFocused, !parsed.valid && styles.inputInvalid]}
        value={value}
        onChangeText={(text) => { if (/^[0-9 .,]*$/.test(text)) onChangeText(text); }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="decimal-pad"
        placeholder={placeholder || '0'}
        placeholderTextColor={COLORS.textMuted}
        selectionColor={COLORS.primary}
      />
      {!parsed.valid && <Text style={styles.validation}>{integer ? 'Valeur entière requise' : 'Format numérique ambigu'}</Text>}
      {info && <Text style={styles.info}>{info}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: SPACING.md },
  label: { color: COLORS.textSecondary, fontSize: FONT_SIZE.sm, marginBottom: SPACING.xs, fontWeight: FONT_WEIGHT.medium, letterSpacing: 0.2 },
  labelFocused: { color: COLORS.primaryLight },
  input: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm + 3, color: COLORS.text, fontSize: FONT_SIZE.lg, fontWeight: FONT_WEIGHT.semibold },
  inputFocused: { borderColor: COLORS.primary, backgroundColor: COLORS.surface2 },
  inputInvalid: { borderColor: COLORS.loss },
  validation: { color: COLORS.loss, fontSize: FONT_SIZE.xs, marginTop: SPACING.xs },
  info: { color: COLORS.textMuted, fontSize: FONT_SIZE.xs, marginTop: SPACING.xs, fontStyle: 'italic' },
});
