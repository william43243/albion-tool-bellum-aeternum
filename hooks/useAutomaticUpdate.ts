import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import type { VersionManifest } from '../lib/updater';
import { checkForUpdateShared } from '../lib/updateCheckCoordinator';

export function useAutomaticUpdate() {
  const [manifest, setManifest] = useState<VersionManifest | null>(null);
  const [dismissedCode, setDismissedCode] = useState<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let mounted = true;
    let wasBackgrounded = AppState.currentState === 'background';
    const check = () => {
      // An unavailable site must never prevent the player from using the app.
      void checkForUpdateShared().then(result => {
        if (mounted) setManifest(result);
      }).catch(() => {});
    };
    check();
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'background') wasBackgrounded = true;
      if (next === 'active' && wasBackgrounded) {
        wasBackgrounded = false;
        check();
      }
    });
    return () => { mounted = false; subscription.remove(); };
  }, []);

  return {
    manifest,
    promptManifest: manifest && manifest.version_code !== dismissedCode ? manifest : null,
    dismiss: () => { if (manifest) setDismissedCode(manifest.version_code); },
  };
}
