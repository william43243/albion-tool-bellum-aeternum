/**
 * UpdateSection
 *
 * Settings-screen section that lets the user manually check for an APK
 * update, download it, verify it, and hand it to Android's package
 * installer. See lib/updater.ts for the actual crypto + install logic.
 *
 * On web this component renders nothing (there's no APK to update). On
 * Android, it walks the user through a small state machine:
 *
 *   idle → checking → (updateAvailable | upToDate | error)
 *   updateAvailable → downloading → (ready | error)
 *   ready → installing (hand-off to Android installer)
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
import {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  VersionManifest,
} from '../lib/updater';
import { trackEvent } from '../lib/analytics';

interface Props {
  t: (key: any) => any;
  lang: Language;
}

type State =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'updateAvailable'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error';

const LAST_KNOWN_VERSION_KEY = '@albion/lastKnownVersion';

export default function UpdateSection({ t, lang }: Props) {
  const [state, setState] = useState<State>('idle');
  const [manifest, setManifest] = useState<VersionManifest | null>(null);
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const installedVersion = Application.nativeApplicationVersion ?? '—';

  // On mount: detect whether the user has just completed an update. If the
  // version on disk doesn't match the version we last remembered, the app
  // was updated since the last run — log it as a successful install.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const lastKnown = await AsyncStorage.getItem(LAST_KNOWN_VERSION_KEY);
        const current = Application.nativeApplicationVersion;
        if (current && lastKnown && lastKnown !== current) {
          trackEvent('update_install_success', 'updates', {
            from: lastKnown,
            to: current,
          });
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
    setState('checking');
    setErrorMessage(null);
    trackEvent('update_check_started', 'updates');
    try {
      const result = await checkForUpdate();
      if (result) {
        setManifest(result);
        setState('updateAvailable');
        trackEvent('update_check_completed', 'updates', {
          target: result.version,
          available: true,
        });
      } else {
        setState('upToDate');
        trackEvent('update_check_completed', 'updates', { available: false });
      }
    } catch (err: any) {
      setErrorMessage(err?.message || String(err));
      setState('error');
      trackEvent('update_check_failed', 'updates', {
        error: String(err?.message || err).slice(0, 200),
      });
    }
  };

  const handleDownload = async () => {
    if (!manifest) return;
    setState('downloading');
    setProgress(0);
    setErrorMessage(null);
    trackEvent('update_download_started', 'updates', {
      target: manifest.version,
    });
    try {
      const uri = await downloadUpdate(manifest, (frac) => setProgress(frac));
      setLocalPath(uri);
      setState('ready');
      trackEvent('update_download_completed', 'updates', {
        target: manifest.version,
      });
    } catch (err: any) {
      setErrorMessage(err?.message || String(err));
      setState('error');
      trackEvent('update_download_failed', 'updates', {
        target: manifest.version,
        error: String(err?.message || err).slice(0, 200),
      });
    }
  };

  const handleInstall = async () => {
    if (!localPath || !manifest) return;
    // Fire-and-forget analytics synchronously BEFORE the intent: once the
    // installer kicks in our process may be killed and trailing awaits
    // would never resolve.
    trackEvent('update_install_attempted', 'updates', {
      target: manifest.version,
    });
    setState('installing');
    try {
      await installUpdate(localPath);
    } catch (err: any) {
      setErrorMessage(err?.message || String(err));
      setState('error');
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
            <Text style={styles.warning}>{t('uninstallOldVersionWarning')}</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleDownload}>
              <Text style={styles.primaryButtonText}>{t('downloadUpdate')}</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'downloading' && (
          <>
            <Text style={styles.statusText}>
              {t('downloading')} {Math.round(progress * 100)}%
            </Text>
            <View style={styles.progressBarBg}>
              <View
                style={[styles.progressBarFill, { width: `${Math.round(progress * 100)}%` }]}
              />
            </View>
          </>
        )}

        {state === 'ready' && manifest && (
          <>
            <Text style={styles.readyText}>
              v{manifest.version} {t('readyToInstall')}
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleInstall}>
              <Text style={styles.primaryButtonText}>{t('installNow')}</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'installing' && (
          <View style={styles.statusRow}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={styles.statusText}>{t('installing')}</Text>
          </View>
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
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  primaryButtonText: {
    color: COLORS.background,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
  },
  secondaryButton: {
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
  progressBarBg: {
    height: 8,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: BORDER_RADIUS.sm,
    overflow: 'hidden',
    marginTop: SPACING.sm,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
  },
  readyText: {
    color: COLORS.profit,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  errorText: {
    color: COLORS.loss,
    fontSize: FONT_SIZE.sm,
    marginBottom: SPACING.sm,
  },
});
