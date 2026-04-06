// Unified LLM Bridge — routes to LiteRT (Android) or WebLLM (Web)

import { Platform } from 'react-native';
import * as LiteRT from './litert';

// Re-export types
export type { StreamCallbacks, DownloadCallbacks, DownloadedModel, InitResult } from './litert';

const isWeb = Platform.OS === 'web';

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
    // For web, we need sync return of { promise, cancel } — use a deferred pattern
    let resolveModule: (m: typeof import('./webllm')) => void;
    const moduleReady = new Promise<typeof import('./webllm')>((r) => { resolveModule = r; });
    getWebLLMModule().then((m) => resolveModule!(m));

    let cancelFn = () => {};
    const promise = moduleReady.then((wllm) => {
      const result = wllm.downloadModel(modelId, url, filename, callbacks);
      cancelFn = result.cancel;
      return result.promise;
    });
    return { promise, cancel: () => cancelFn() };
  }
  return LiteRT.downloadModel(modelId, url, filename, callbacks);
}

export async function deleteModel(filename: string) {
  if (isWeb) return (await getWebLLMModule()).deleteModel(filename);
  return LiteRT.deleteModel(filename);
}

export async function initialize(modelFilename: string, systemPrompt: string, serverBaseUrl: string) {
  if (isWeb) return (await getWebLLMModule()).initialize(modelFilename, systemPrompt, serverBaseUrl);
  return LiteRT.initialize(modelFilename, systemPrompt, serverBaseUrl);
}

export function sendMessage(message: string, callbacks: LiteRT.StreamCallbacks) {
  if (isWeb) {
    let cleanup = () => {};
    getWebLLMModule().then((wllm) => { cleanup = wllm.sendMessage(message, callbacks); });
    return () => cleanup();
  }
  return LiteRT.sendMessage(message, callbacks);
}

export function sendMessageWithImage(message: string, imagePath: string, callbacks: LiteRT.StreamCallbacks) {
  if (isWeb) {
    let cleanup = () => {};
    getWebLLMModule().then((wllm) => { cleanup = wllm.sendMessageWithImage(message, imagePath, callbacks); });
    return () => cleanup();
  }
  return LiteRT.sendMessageWithImage(message, imagePath, callbacks);
}

export async function resetConversation(systemPrompt: string) {
  if (isWeb) return (await getWebLLMModule()).resetConversation(systemPrompt);
  return LiteRT.resetConversation(systemPrompt);
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
