import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';
import { QUALITY_LABELS, Quality } from '../lib/api';
import { Language } from '../lib/i18n';

export default function QualitySelector({ value, onChange, lang }: { value: Quality; onChange: (quality: Quality) => void; lang: Language }) {
  return <View>
    <Text style={styles.label}>{lang === 'fr' ? 'Qualité' : lang === 'es' ? 'Calidad' : 'Quality'}: {QUALITY_LABELS[value][lang]}</Text>
    <View style={styles.row}>{([1, 2, 3, 4, 5] as Quality[]).map((quality) => <TouchableOpacity key={quality} onPress={() => onChange(quality)} style={[styles.chip, quality === value && styles.active]} accessibilityRole="button" accessibilityState={{selected: quality === value}} accessibilityLabel={QUALITY_LABELS[quality][lang]}><Text style={[styles.text, quality === value && styles.activeText]}>{quality}</Text></TouchableOpacity>)}</View>
  </View>;
}
const styles = StyleSheet.create({
  label: { color: COLORS.textSecondary, fontSize: FONT_SIZE.sm, marginBottom: SPACING.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.md },
  chip: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: BORDER_RADIUS.sm },
  active: { borderColor: COLORS.primary, backgroundColor: COLORS.primarySoft },
  text: { color: COLORS.textMuted, fontWeight: '700' },
  activeText: { color: COLORS.primary },
});
