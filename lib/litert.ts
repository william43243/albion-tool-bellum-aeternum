// LiteRT-LM Native Module Bridge
// Communicates with the Kotlin LiteRTModule via React Native bridge

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { LiteRTModule } = NativeModules;

const emitter = Platform.OS === 'android' && LiteRTModule
  ? new NativeEventEmitter(LiteRTModule)
  : null;

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export interface DownloadCallbacks {
  onProgress: (bytesDownloaded: number, totalBytes: number, percent: number) => void;
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

export async function isModelDownloaded(filename: string): Promise<boolean> {
  if (Platform.OS !== 'android' || !LiteRTModule) return false;
  return LiteRTModule.isModelDownloaded(filename);
}

export async function getFreeDiskSpace(): Promise<number> {
  if (Platform.OS !== 'android' || !LiteRTModule) return -1;
  return LiteRTModule.getFreeDiskSpace();
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
  callbacks: DownloadCallbacks
): { promise: Promise<{ path: string; sizeBytes: number }>; cancel: () => void } {
  if (!emitter || !LiteRTModule) {
    return {
      promise: Promise.reject(new Error('LiteRT-LM not available')),
      cancel: () => {},
    };
  }

  const sub = emitter.addListener('onDownloadProgress', (event) => {
    if (event.modelId === modelId) {
      callbacks.onProgress(event.bytesDownloaded, event.totalBytes, event.percent);
    }
  });

  const promise = LiteRTModule.downloadModel(modelId, url, filename).then(
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
    promise,
    cancel: () => {
      sub.remove();
      LiteRTModule.cancelDownload(modelId);
    },
  };
}

export async function deleteModel(filename: string): Promise<boolean> {
  if (Platform.OS !== 'android' || !LiteRTModule) return false;
  return LiteRTModule.deleteModel(filename);
}

// ─── Engine Lifecycle ────────────────────────────���───────────

export async function initialize(modelFilename: string, systemPrompt: string, serverBaseUrl: string): Promise<boolean> {
  if (Platform.OS !== 'android' || !LiteRTModule) {
    throw new Error('LiteRT-LM is only available on Android');
  }
  return LiteRTModule.initialize(modelFilename, systemPrompt, serverBaseUrl);
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
      callbacks.onError(event.error);
    }
  });

  const cleanup = () => {
    tokenSub.remove();
    doneSub.remove();
    errorSub.remove();
  };

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
      callbacks.onError(event.error);
    }
  });

  const cleanup = () => {
    tokenSub.remove();
    doneSub.remove();
    errorSub.remove();
  };

  LiteRTModule.sendMessageWithImage(message, imagePath, requestId).catch((err: Error) => {
    cleanup();
    callbacks.onError(err.message);
  });

  return cleanup;
}

export async function resetConversation(systemPrompt: string): Promise<boolean> {
  if (Platform.OS !== 'android' || !LiteRTModule) return false;
  return LiteRTModule.resetConversation(systemPrompt);
}

export async function destroy(): Promise<boolean> {
  if (Platform.OS !== 'android' || !LiteRTModule) return false;
  return LiteRTModule.destroy();
}
