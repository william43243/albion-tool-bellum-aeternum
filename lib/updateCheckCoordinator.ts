import { checkForUpdate, type VersionManifest } from './updater';

// A manual check can share the request already started when the app opens.
let inFlight: Promise<VersionManifest | null> | null = null;

export function checkForUpdateShared(): Promise<VersionManifest | null> {
  if (inFlight) return inFlight;
  const request = checkForUpdate();
  const tracked = request.finally(() => {
    if (inFlight === tracked) inFlight = null;
  });
  inFlight = tracked;
  return tracked;
}
