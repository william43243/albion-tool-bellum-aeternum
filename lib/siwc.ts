import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

export interface SiwcSession { status: 'disconnected' | 'connecting' | 'connected' | 'expired'; email?: string; lastError?: string; planEnabled?: boolean }
export interface SiwcModel { id: string; displayName: string; supportsFast: boolean }
export type SiwcEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; status: 'running' | 'completed' | 'error'; callId: string; result?: string }
  | { type: 'completed'; requestedServiceTier?: string; effectiveServiceTier?: string; fastConfirmed?: boolean }
  | { type: 'error'; code: string; message: string; httpStatus?: number; param?: string; requestIdProvider?: string; bodyShape?: string };
export interface SiwcGenerateOptions { model: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; fast?: boolean; experimentalFast?: boolean; reasoningEffort?: 'high'; serverBaseUrl: string; playerCity?: string | null; isPremium?: boolean }
function native() {
  if (Platform.OS !== 'android' || !NativeModules.Siwc) throw new Error('SIWC_ANDROID_REQUIRED');
  return NativeModules.Siwc;
}
export async function getSession(): Promise<SiwcSession> {
  if (Platform.OS !== 'android' || !NativeModules.Siwc) return { status: 'disconnected' };
  return JSON.parse(await native().getSession());
}
export async function connect(): Promise<void> { await native().connect(); }
/** Local sign out. The user must disconnect Albion Tool in ChatGPT settings to revoke remote access. */
export async function disconnect(): Promise<void> { await native().disconnect(); }
export async function getModels(): Promise<SiwcModel[]> { return JSON.parse(await native().getModels()); }
let sequence = 0;
export async function generate(options: SiwcGenerateOptions, onEvent: (event: SiwcEvent) => void): Promise<string> {
  const module = native();
  const requestId = `siwc-${++sequence}`;
  const listener = new NativeEventEmitter<{ siwcEvent: [string] }>(module).addListener('siwcEvent', (raw) => {
    const event = JSON.parse(raw);
    if (event.requestId === requestId) onEvent(event as SiwcEvent);
  });
  try { return await module.generate(JSON.stringify(options), requestId); }
  finally { listener.remove(); }
}
export async function cancel(): Promise<void> { await native().cancel(); }
