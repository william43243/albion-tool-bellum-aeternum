import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BellumIcon from './BellumIcon';
import type {Language} from '../lib/i18n';
import { CITIES, City } from '../lib/api';
import { COLORS, FONT_SIZE, SPACING, BORDER_RADIUS } from '../constants/theme';

interface Props {
  visible: boolean;
  lang?: Language;
  city: City | null;
  required?: boolean;
  onSelect: (city: City) => void;
  onClose?: () => void;
}

export default function CitySelector({ visible, city, lang = 'fr', required = false, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const tr = (fr: string, en: string, es: string) => lang === 'es' ? es : lang === 'en' ? en : fr;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, SPACING.xl), paddingLeft: insets.left, paddingRight: insets.right }]} accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={{flex: 1}}>
              <Text accessibilityRole="header" style={styles.title}>{tr("Choisir ma ville", "Choose my city", "Elegir mi ciudad")}</Text>
              <Text style={styles.subtitle}>{tr('Point de départ des recommandations et des routes.', 'Starting point for recommendations and routes.', 'Punto de partida de las recomendaciones y rutas.')}</Text>
            </View>
            {!required && onClose && (
              <TouchableOpacity style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel={tr("Fermer", "Close", "Cerrar")}>
                <BellumIcon name="close" size={20} color={COLORS.text} />
              </TouchableOpacity>
            )}
          </View>
          <ScrollView contentContainerStyle={styles.grid}>
            {CITIES.map((option) => (
              <TouchableOpacity
                key={option}
                style={[styles.cityButton, city === option && styles.cityButtonActive]}
                onPress={() => onSelect(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: city === option }}
              >
                <Text style={[styles.cityText, city === option && styles.cityTextActive]}>{option}</Text>
                {city === option && <BellumIcon name="check" size={18} color={COLORS.primary} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: COLORS.overlay },
  sheet: {
    maxHeight: '72%',
    backgroundColor: COLORS.background,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    paddingBottom: SPACING.xl,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: SPACING.lg, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { color: COLORS.text, fontSize: FONT_SIZE.xl, fontWeight: '800' },
  subtitle: { color: COLORS.textMuted, fontSize: FONT_SIZE.sm, marginTop: SPACING.xs, maxWidth: 280 },
  close: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  grid: { paddingHorizontal: SPACING.lg },
  cityButton: {
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  cityButtonActive: { backgroundColor: COLORS.primaryFaint, borderBottomColor: COLORS.primary },
  cityText: { color: COLORS.textSecondary, fontSize: FONT_SIZE.md, fontWeight: '600' },
  cityTextActive: { color: COLORS.primary },
});
