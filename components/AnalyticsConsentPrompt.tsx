import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';

interface Props {
  visible: boolean;
  t: (key: any) => any;
  onChoice: (choice: 'accepted' | 'refused') => void;
}

export default function AnalyticsConsentPrompt({ visible, t, onChoice }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => undefined}>
      <View style={styles.backdrop} accessibilityViewIsModal>
        <View style={styles.card} accessibilityRole="alert" accessibilityLabel={t('analyticsConsentTitle')}>
          <Text style={styles.title}>{t('analyticsConsentTitle')}</Text>
          <Text style={styles.body}>{t('analyticsConsentPrompt')}</Text>
          <View style={styles.actions}>
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.secondaryButton}
              onPress={() => onChoice('refused')}
            >
              <Text style={styles.secondaryText}>{t('analyticsRefuse')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.primaryButton}
              onPress={() => onChoice('accepted')}
            >
              <Text style={styles.primaryText}>{t('analyticsAccept')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: SPACING.xl, backgroundColor: '#000000CC' },
  card: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.xl, borderWidth: 1, borderColor: COLORS.borderStrong },
  title: { color: COLORS.primary, fontSize: FONT_SIZE.xl, fontWeight: '800', marginBottom: SPACING.md },
  body: { color: COLORS.text, fontSize: FONT_SIZE.md, lineHeight: 22, marginBottom: SPACING.xl },
  actions: { flexDirection: 'row', gap: SPACING.md },
  secondaryButton: { flex: 1, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: COLORS.borderStrong, alignItems: 'center' },
  primaryButton: { flex: 1, padding: SPACING.md, borderRadius: BORDER_RADIUS.md, backgroundColor: COLORS.primary, alignItems: 'center' },
  secondaryText: { color: COLORS.text, fontWeight: '700' },
  primaryText: { color: COLORS.background, fontWeight: '800' },
});
