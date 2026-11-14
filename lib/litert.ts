// LiteRT-LM Native Module Bridge
// Communicates with the Kotlin LiteRTModule via React Native bridge

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import * as Crypto from 'expo-crypto';

const { LiteRTModule } = NativeModules;

type LiteRTEvents = {
  onDownloadProgress: [ActiveDownload];
  onLiteRTToken: [{ requestId: string; token: string }];
  onLiteRTDone: [{ requestId: string }];
  onLiteRTError: [{ requestId: string; error: string; errorCode?: string }];
};
const emitter = Platform.OS === 'android' && LiteRTModule
  ? new NativeEventEmitter<LiteRTEvents>(LiteRTModule)
  : null;
let downloadAttemptSequence = 0;

// Native debug flag also works for a production JS bundle inside a debug APK.
// Hash asynchronously without delaying, retrying or modifying inference. No
// question text, image path, model output or tool payload is logged here.
function traceInferenceInput(message: string, requestId: string, image: boolean): void {
  if (LiteRTModule?.debugInference !== true) return;
  try {
    void Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, message)
      .then((sha256) => {
        console.debug(`[LiteRTTrace] input stage=js request=${requestId} chars=${message.length} analysis=${message.startsWith('AI_DECISION_INPUT')} image=${image} sha256=${sha256}`);
      }).catch(() => {}); // Diagnostics must never alter send/error behavior.
  } catch { /* A diagnostic failure must not prevent inference. */ }
}

export function createDownloadAttemptId(): string {
  downloadAttemptSequence += 1;
  return `${Date.now()}-${downloadAttemptSequence}-${Math.random().toString(36).slice(2)}`;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: string, errorCode?: string) => void;
}

export interface DownloadCallbacks {
  onProgress: (bytesDownloaded: number, totalBytes: number, percent: number) => void;
}

export interface ActiveDownload {
  downloadId: number;
  attemptId: string;
  modelId: string;
  filename: string;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  status: 'pending' | 'downloading' | 'verifying' | 'complete' | 'failed';
}

export interface DownloadedModel {
  id: string;
  filename: string;
  path: string;
  sizeBytes: number;
}

// ─── Model Management ────────────────────────────────────────

export async function getDownloadedModels(): Promise<DownloadedModel[]> {
  if (Platform.OS !== 'android' || !LiteRTModule) return [];
  return LiteRTModule.getDownloadedModels();
}

export async function isModelDownloaded(filename: string, expectedSizeBytes: number, expectedSha256: string): Promise<boolean> {
  if (Platform.OS !== 'android' || !LiteRTModule) return false;
  return LiteRTModule.isModelDownloaded(filename, expectedSizeBytes, expectedSha256);
}

export async function getFreeDiskSpace(): Promise<number> {
  if (Platform.OS !== 'android' || !LiteRTModule) return -1;
  return LiteRTModule.getFreeDiskSpace();
}

export async function getActiveDownload(): Promise<ActiveDownload | null> {
  if (Platform.OS !== 'android' || !LiteRTModule) return null;
  return LiteRTModule.getActiveDownload();
}

export function observeDownloadProgress(callback: (event: ActiveDownload) => void): () => void {
  if (!emitter) return () => {};
  const subscription = emitter.addListener('onDownloadProgress', callback);
  return () => subscription.remove();
}

export async function cancelDownload(modelId: string, attemptId: string): Promise<boolean> {
  if (Platform.OS !== 'android' || !LiteRTModule) return false;
  return LiteRTModule.cancelDownload(modelId, attemptId);
}

export async function acknowledgeDownloadResult(modelId: string, attemptId: string, downloadId: number): Promise<boolean> {
  if (Platform.OS !== 'android' || !LiteRTModule) return false;
  return LiteRTModule.acknowledgeDownloadResult(modelId, attemptId, downloadId);
}

/**
 * Start a model download via Android DownloadManager.
 * Continues in background even if app is minimized.
 * Shows a notification in the status bar.
 */
export function downloadModel(
  modelId: string,
  url: string,
  filename: string,
  expectedSizeBytes: number,
  expectedSha256: string,
  callbacks: DownloadCallbacks
): { attemptId: string; promise: Promise<{ path: string; sizeBytes: number }>; cancel: () => Promise<boolean> } {
  const attemptId = createDownloadAttemptId();
  if (!emitter || !LiteRTModule) {
    return {
      attemptId,
      promise: Promise.reject(new Error('LiteRT-LM not available')),
      cancel: async () => false,
    };
  }

  const sub = emitter.addListener('onDownloadProgress', (event) => {
    if (event.attemptId === attemptId) {
      callbacks.onProgress(event.bytesDownloaded, event.totalBytes, event.percent);
    }
  });

  const promise = LiteRTModule.downloadModel(attemptId, modelId, url, filename, expectedSizeBytes, expectedSha256).then(
    (result: any) => {
      sub.remove();
      return result;
    },
    (error: any) => {
      sub.remove();
      throw error;
    }
  );

  return {
    attemptId,
    promise,
    cancel: async () => {
      const cancelled = await LiteRTModule.cancelDownload(modelId, attemptId);
      if (cancelled) sub.remove();
      return cancelled;
    },
  };
}

export async function deleteModel(filename: string): Promise<boolean> {
  if (Platform.OS !== 'android' || !LiteRTModule) return false;
  return LiteRTModule.deleteModel(filename);
}

// ─── Engine Lifecycle ────────────────────────────���───────────

export interface InitResult {
  success: boolean;
  hasVision: boolean;
  maxOutputTokens?: number;
  backendUsed: 'gpu' | 'cpu' | 'unknown';
  isMediaTek: boolean;
  chipset: string;
}

/** Applied to the next engine initialization. A null maximum uses the runtime default. */
export interface LocalRuntimeOptions {
  maxNumTokens: number | null;
  topK: number;
  topP: number;
  temperature: number;
}

/** Native cache usage is not a prediction of the next request's token cost. */
export interface LocalContextUsage {
  tokens: number | null;
  configuredMaxTokens: number | null;
}

export async function setRuntimeOptions(options: LocalRuntimeOptions): Promise<void> {
  if (Platform.OS !== 'android' || !LiteRTModule) {
    throw new Error('LiteRT-LM is only available on Android');
  }
  await LiteRTModule.setRuntimeOptions(options);
}

export async function getContextUsage(): Promise<LocalContextUsage> {
  if (Platform.OS !== 'android' || !LiteRTModule) {
    return { tokens: null, configuredMaxTokens: null };
  }
  return LiteRTModule.getContextUsage();
}

export async function compactConversation(
  systemPrompt: string,
  serverBaseUrl: string,
  history: string,
): Promise<{ mode: 'summary' | 'truncated' }> {
  if (Platform.OS !== 'android' || !LiteRTModule) {
    throw new Error('LiteRT-LM is only available on Android');
  }
  return LiteRTModule.compactConversation(systemPrompt, serverBaseUrl, history);
}

export async function initialize(
  modelFilename: string,
  systemPrompt: string,
  serverBaseUrl: string,
  supportsVision = false,
  supportsTools = false,
  preferCpuText = false
): Promise<InitResult> {
  if (Platform.OS !== 'android' || !LiteRTModule) {
    throw new Error('LiteRT-LM is only available on Android');
  }
  return LiteRTModule.initialize(modelFilename, systemPrompt, serverBaseUrl, supportsVision, supportsTools, preferCpuText);
}

export function sendMessage(
  message: string,
  callbacks: StreamCallbacks
): () => void {
  if (!emitter) {
    callbacks.onError('LiteRT-LM not available on this platform');
    return () => {};
  }

  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const tokenSub = emitter.addListener('onLiteRTToken', (event) => {
    if (event.requestId === requestId) callbacks.onToken(event.token);
  });

  const doneSub = emitter.addListener('onLiteRTDone', (event) => {
    if (event.requestId === requestId) {
      cleanup();
      callbacks.onDone();
    }
  });

  const errorSub = emitter.addListener('onLiteRTError', (event) => {
    if (event.requestId === requestId) {
      cleanup();
      callbacks.onError(event.error, event.errorCode);
    }
  });

  const cleanup = () => {
    tokenSub.remove();
    doneSub.remove();
    errorSub.remove();
    // Detaching listeners is not enough: end the on-device inference too.
    LiteRTModule.cancelMessage(requestId).catch(() => {});
  };

  traceInferenceInput(message, requestId, false);
  LiteRTModule.sendMessage(message, requestId).catch((err: Error) => {
    cleanup();
    callbacks.onError(err.message);
  });

  return cleanup;
}

/**
 * Send a message with an image (for multimodal models like Qwen3.5)
 */
export function sendMessageWithImage(
  message: string,
  imagePath: string,
  callbacks: StreamCallbacks
): () => void {
  if (!emitter) {
    callbacks.onError('LiteRT-LM not available on this platform');
    return () => {};
  }

  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const tokenSub = emitter.addListener('onLiteRTToken', (event) => {
    if (event.requestId === requestId) callbacks.onToken(event.token);
  });

  const doneSub = emitter.addListener('onLiteRTDone', (event) => {
    if (event.requestId === requestId) {
      cleanup();
      callbacks.onDone();
    }
  });

  const errorSub = emitter.addListener('onLiteRTError', (event) => {
    if (event.requestId === requestId) {
      cleanup();
      callbacks.onError(event.error, event.errorCode);
    }
  });

  const cleanup = () => {
    tokenSub.remove();
    doneSub.remove();
    errorSub.remove();
    // Detaching listeners is not enough: end the on-device inference too.
    LiteRTModule.cancelMessage(requestId).catch(() => {});
  };

  traceInferenceInput(message, requestId, true);
  LiteRTModule.sendMessageWithImage(message, imagePath, requestId).catch((err: Error) => {
    cleanup();
    callbacks.onError(err.message);
  });

  return cleanup;
}

export async function resetConversation(systemPrompt: string, serverBaseUrl: string): Promise<boolean> {
  if (Platform.OS !== 'android' || !LiteRTModule) return false;
  return LiteRTModule.resetConversation(systemPrompt, serverBaseUrl);
}

export async function destroy(): Promise<boolean> {
  if (Platform.OS !== 'android' || !LiteRTModule) return false;
  return LiteRTModule.destroy();
}
