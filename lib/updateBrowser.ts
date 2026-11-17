import { Linking } from 'react-native';
import type { VersionManifest } from './updater';

// The signed manifest must still point to this site's HTTPS origin.
export function updateDownloadUrl(manifest: Pick<VersionManifest, 'apk_url'>): string {
  const url = manifest.apk_url;
  if (typeof url !== 'string' || !/^https:\/\/albion-tool-bellum-aeternum\.com\/[^\s\\\u0000-\u001f]*$/i.test(url)) {
    throw new Error('Untrusted update download URL');
  }
  return url;
}

export async function openUpdateInBrowser(manifest: Pick<VersionManifest, 'apk_url'>): Promise<void> {
  await Linking.openURL(updateDownloadUrl(manifest));
}
