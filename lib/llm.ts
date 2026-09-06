// Unified LLM Bridge — routes to LiteRT (Android) or WebLLM (Web)

import { Platform } from 'react-native';
import * as LiteRT from './litert';

// Re-export types
export type { StreamCallbacks, DownloadCallbacks, DownloadedModel, InitResult } from './litert';

const isWeb = Platform.OS === 'web';

type CancelToken = { cancelled: boolean; cleanup?: () => void };

// Lazy-load WebLLM only on web — metro.config.js excludes @mlc-ai/web-llm on Android
let _webllm: typeof import('./webllm') | null = null;
async function getWebLLMModule() {
  if (!_webllm) _webllm = await import('./webllm');
  return _webllm;
}

// Wrap each function to route web→WebLLM, android→LiteRT
export async function getDownloadedModels() {
  if (isWeb) return (await getWebLLMModule()).getDownloadedModels();
  return LiteRT.getDownloadedModels();
}

export async function isModelDownloaded(filename: string) {
  if (isWeb) return (await getWebLLMModule()).isModelDownloaded(filename);
  return LiteRT.isModelDownloaded(filename);
}

export async function getFreeDiskSpace() {
  if (isWeb) return (await getWebLLMModule()).getFreeDiskSpace();
  return LiteRT.getFreeDiskSpace();
}

export function downloadModel(
  modelId: string,
  url: string,
  filename: string,
  callbacks: LiteRT.DownloadCallbacks
) {
  if (isWeb) {
    const token: CancelToken = { cancelled: false };
    const promise = getWebLLMModule().then((wllm) => {
      if (token.cancelled) throw new Error('cancelled');
      const result = wllm.downloadModel(modelId, url, filename, callbacks);
      token.cleanup = result.cancel;
      if (token.cancelled) result.cancel();
      return result.promise;
    });
    return {
      promise,
      cancel: () => {
        token.cancelled = true;
        token.cleanup?.();
      },
    };
  }
  return LiteRT.downloadModel(modelId, url, filename, callbacks);
}

export async function deleteModel(filename: string) {
  if (isWeb) return (await getWebLLMModule()).deleteModel(filename);
  return LiteRT.deleteModel(filename);
}

export async function initialize(
  modelFilename: string,
  systemPrompt: string,
  serverBaseUrl: string,
  supportsVision: boolean = false
) {
  if (isWeb) return (await getWebLLMModule()).initialize(modelFilename, systemPrompt, serverBaseUrl);
  return LiteRT.initialize(modelFilename, systemPrompt, serverBaseUrl, supportsVision);
}

export function sendMessage(message: string, callbacks: LiteRT.StreamCallbacks) {
  if (isWeb) {
    const token: CancelToken = { cancelled: false };
    getWebLLMModule()
      .then((wllm) => {
        if (token.cancelled) return;
        token.cleanup = wllm.sendMessage(message, callbacks);
        if (token.cancelled) token.cleanup?.();
      })
      .catch((err) => {
        if (!token.cancelled) callbacks.onError(err?.message || String(err));
      });
    return () => {
      token.cancelled = true;
      token.cleanup?.();
    };
  }
  return LiteRT.sendMessage(message, callbacks);
}

export function sendMessageWithImage(message: string, imagePath: string, callbacks: LiteRT.StreamCallbacks) {
  if (isWeb) {
    const token: CancelToken = { cancelled: false };
    getWebLLMModule()
      .then((wllm) => {
        if (token.cancelled) return;
        token.cleanup = wllm.sendMessageWithImage(message, imagePath, callbacks);
        if (token.cancelled) token.cleanup?.();
      })
      .catch((err) => {
        if (!token.cancelled) callbacks.onError(err?.message || String(err));
      });
    return () => {
      token.cancelled = true;
      token.cleanup?.();
    };
  }
  return LiteRT.sendMessageWithImage(message, imagePath, callbacks);
}

export async function resetConversation(systemPrompt: string, serverBaseUrl: string) {
  if (isWeb) return (await getWebLLMModule()).resetConversation(systemPrompt);
  return LiteRT.resetConversation(systemPrompt, serverBaseUrl);
}

export async function destroy() {
  if (isWeb) return (await getWebLLMModule()).destroy();
  return LiteRT.destroy();
}

// Web-only: WebGPU check
export async function isWebGPUAvailable(): Promise<boolean> {
  if (!isWeb) return false;
  return (await getWebLLMModule()).isWebGPUAvailable();
}
