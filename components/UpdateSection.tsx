/**
 * UpdateSection
 *
 * Settings-screen section that lets the user manually check for an APK
 * update and open the verified site's download in the browser.
 *
 * On web this component renders nothing (there's no APK to update). On
 * Android, it walks the user through a small state machine:
 *
 *   idle → checking → (updateAvailable | upToDate | error)
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';
import { Language } from '../lib/i18n';
import type { VersionManifest } from '../lib/updater';
import { checkForUpdateShared } from '../lib/updateCheckCoordinator';
import { openUpdateInBrowser } from '../lib/updateBrowser';
import { captureAnalyticsAuthorization, trackEvent } from '../lib/analytics';

interface Props {
  t: (key: any) => any;
  lang: Language;
}

type State =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'updateAvailable'
  | 'error';

const LAST_KNOWN_VERSION_KEY = '@albion/lastKnownVersion';

export default function UpdateSection({ t, lang }: Props) {
  const [state, setState] = useState<State>('idle');
  const [manifest, setManifest] = useState<VersionManifest | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openingBrowser, setOpeningBrowser] = useState(false);

  const installedVersion = Application.nativeApplicationVersion ?? '—';

  // On mount: detect whether the user has just completed an update. If the
  // version on disk doesn't match the version we last remembered, the app
  // was updated since the last run — log it as a successful install.
  useEffect(() => {
    let cancelled = false;
    const analyticsAuthorization = captureAnalyticsAuthorization();
    (async () => {
      try {
        const lastKnown = await AsyncStorage.getItem(LAST_KNOWN_VERSION_KEY);
        const current = Application.nativeApplicationVersion;
        if (current && lastKnown && lastKnown !== current) {
          trackEvent('update_install_success', 'updates', {
            from: lastKnown,
            to: current,
          }, analyticsAuthorization);
        }
        if (current && !cancelled) {
          await AsyncStorage.setItem(LAST_KNOWN_VERSION_KEY, current);
        }
      } catch {
        // Non-fatal — ignore.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The whole flow is Android-only. Hide the section on web/iOS entirely.
  if (Platform.OS !== 'android') {
    return null;
  }

  const handleCheck = async () => {
    const analyticsAuthorization = captureAnalyticsAuthorization();
    setState('checking');
    setErrorMessage(null);
    trackEvent('update_check_started', 'updates', {}, analyticsAuthorization);
    try {
      const result = await checkForUpdateShared();
      if (result) {
        setManifest(result);
        setState('updateAvailable');
        trackEvent('update_check_completed', 'updates', {
          target: result.version,
          available: true,
        }, analyticsAuthorization);
      } else {
        setState('upToDate');
        trackEvent('update_check_completed', 'updates', { available: false }, analyticsAuthorization);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || String(err));
      setState('error');
      trackEvent('update_check_failed', 'updates', {
      }, analyticsAuthorization);
    }
  };

  const handleDownload = async () => {
    if (!manifest || openingBrowser) return;
    setOpeningBrowser(true);
    const analyticsAuthorization = captureAnalyticsAuthorization();
    setErrorMessage(null);
    try {
      await openUpdateInBrowser(manifest);
      trackEvent('update_browser_opened', 'updates', { target: manifest.version }, analyticsAuthorization);
    } catch {
      setErrorMessage(t('updateBrowserError'));
      setState('error');
      trackEvent('update_browser_open_failed', 'updates', {
        target: manifest.version,
      }, analyticsAuthorization);
    } finally {
      setOpeningBrowser(false);
    }
  };

  const handleRetry = () => {
    setErrorMessage(null);
    setState('idle');
  };

  const releaseNotes =
    manifest && (lang === 'fr' ? manifest.release_notes_fr : manifest.release_notes_en);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('updates')}</Text>

      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>{t('installedVersion')}</Text>
          <Text style={styles.value}>v{installedVersion}</Text>
        </View>

        {state === 'idle' && (
          <TouchableOpacity style={styles.primaryButton} onPress={handleCheck}>
            <Text style={styles.primaryButtonText}>{t('checkForUpdates')}</Text>
          </TouchableOpacity>
        )}

        {state === 'checking' && (
          <View style={styles.statusRow}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={styles.statusText}>{t('checking')}</Text>
          </View>
        )}

        {state === 'upToDate' && (
          <>
            <Text style={styles.upToDateText}>{t('upToDate')}</Text>
            <TouchableOpacity style={styles.secondaryButton} onPress={handleCheck}>
              <Text style={styles.secondaryButtonText}>{t('checkAgain')}</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'updateAvailable' && manifest && (
          <>
            <Text style={styles.newVersionText}>
              {t('updateAvailable')}: v{manifest.version}
            </Text>
            {releaseNotes ? (
              <Text style={styles.releaseNotes}>{releaseNotes}</Text>
            ) : null}
            <Text style={styles.warning}>{t('updateBrowserInstructions')}</Text>
            <TouchableOpacity accessibilityRole="button" disabled={openingBrowser} style={styles.primaryButton} onPress={handleDownload}>
              {openingBrowser ? <ActivityIndicator color={COLORS.onPrimary} /> : <Text style={styles.primaryButtonText}>{t('downloadUpdate')}</Text>}
            </TouchableOpacity>
          </>
        )}

        {state === 'error' && (
          <>
            <Text style={styles.errorText}>
              {t('updateError')}
              {errorMessage ? ': ' + errorMessage : ''}
            </Text>
            <TouchableOpacity style={styles.secondaryButton} onPress={handleRetry}>
              <Text style={styles.secondaryButtonText}>{t('retry')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    marginBottom: SPACING.md,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
  },
  value: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  primaryButton: {
    minHeight: 48, justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  primaryButtonText: {
    color: COLORS.onPrimary,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 48, justifyContent: 'center',
    backgroundColor: COLORS.surfaceLight,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  statusText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.md,
  },
  upToDateText: {
    color: COLORS.profit,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  newVersionText: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  releaseNotes: {
    color: COLORS.text,
    fontSize: FONT_SIZE.sm,
    lineHeight: FONT_SIZE.sm * 1.5,
    marginBottom: SPACING.sm,
  },
  warning: {
    color: COLORS.warning,
    fontSize: FONT_SIZE.xs,
    lineHeight: FONT_SIZE.xs * 1.4,
    marginBottom: SPACING.sm,
  },
  errorText: {
    color: COLORS.loss,
    fontSize: FONT_SIZE.sm,
    marginBottom: SPACING.sm,
  },
});
