import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';
import type { VersionManifest } from '../lib/updater';
import { openUpdateInBrowser } from '../lib/updateBrowser';

type Props = {
  manifest: VersionManifest | null;
  visible: boolean;
  t: (key: any) => any;
  onLater: () => void;
};

export default function UpdatePrompt({ manifest, visible, t, onLater }: Props) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { setError(false); }, [manifest?.version_code]);

  const open = async () => {
    if (!manifest || opening) return;
    setOpening(true);
    setError(false);
    try {
      await openUpdateInBrowser(manifest);
      onLater();
    } catch {
      setError(true);
    } finally {
      setOpening(false);
    }
  };

  return <Modal visible={visible && !!manifest} transparent animationType="fade" onRequestClose={onLater}>
    <View style={styles.backdrop} accessibilityViewIsModal>
      <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
        <View style={styles.card} accessibilityRole="alert">
          <Text style={styles.title}>{t('updateAvailable')}</Text>
          {manifest && <Text style={styles.version}>v{manifest.version}</Text>}
          <Text style={styles.body}>{t('updateBrowserInstructions')}</Text>
          {error && <Text style={styles.error} accessibilityRole="alert">{t('updateBrowserError')}</Text>}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('updateNow')} disabled={opening} style={styles.primary} onPress={() => void open()}>
            {opening ? <ActivityIndicator color={COLORS.onPrimary} /> : <Text style={styles.primaryText}>{t('updateNow')}</Text>}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('updateLater')} disabled={opening} style={styles.secondary} onPress={onLater}>
            <Text style={styles.secondaryText}>{t('updateLater')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: COLORS.overlay },
  center: { flexGrow: 1, justifyContent: 'center', padding: SPACING.xl },
  card: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, borderWidth: 1, borderColor: COLORS.borderStrong, padding: SPACING.xl },
  title: { color: COLORS.text, fontSize: FONT_SIZE.xxl, fontWeight: '800' },
  version: { color: COLORS.primary, fontSize: FONT_SIZE.lg, fontWeight: '700', marginTop: SPACING.sm },
  body: { color: COLORS.textSecondary, fontSize: FONT_SIZE.md, lineHeight: 22, marginTop: SPACING.md, marginBottom: SPACING.lg },
  error: { color: COLORS.loss, marginBottom: SPACING.md },
  primary: { minHeight: 52, padding: SPACING.md, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.md },
  secondary: { minHeight: 48, padding: SPACING.md, justifyContent: 'center', alignItems: 'center', marginTop: SPACING.sm, borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: COLORS.borderStrong },
  primaryText: { color: COLORS.onPrimary, fontSize: FONT_SIZE.md, fontWeight: '800' },
  secondaryText: { color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '700' },
});
