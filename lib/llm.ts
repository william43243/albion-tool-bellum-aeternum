// Android LLM bridge: delegates inference to the native LiteRT module.
import * as LiteRT from './litert';

// Re-export types
export type { StreamCallbacks, DownloadCallbacks, DownloadedModel, InitResult, LocalRuntimeOptions, LocalContextUsage } from './litert';

export async function setRuntimeOptions(options: LiteRT.LocalRuntimeOptions): Promise<void> {
  return LiteRT.setRuntimeOptions(options);
}

export async function getContextUsage(): Promise<LiteRT.LocalContextUsage> {
  return LiteRT.getContextUsage();
}

export async function compactConversation(systemPrompt: string, serverBaseUrl: string, history: string): Promise<{ mode: 'summary' | 'truncated' }> {
  return LiteRT.compactConversation(systemPrompt, serverBaseUrl, history);
}

// Preserve the typed bridge API consumed by the advisor.
export async function getDownloadedModels() {
  return LiteRT.getDownloadedModels();
}

export async function isModelDownloaded(filename: string, expectedSizeBytes: number, expectedSha256: string) {
  return LiteRT.isModelDownloaded(filename, expectedSizeBytes, expectedSha256);
}

export async function getFreeDiskSpace() {
  return LiteRT.getFreeDiskSpace();
}

export async function getActiveDownload(): Promise<LiteRT.ActiveDownload | null> {
  return LiteRT.getActiveDownload();
}

export function observeDownloadProgress(callback: (event: LiteRT.ActiveDownload) => void): () => void {
  return LiteRT.observeDownloadProgress(callback);
}

export async function cancelDownload(modelId: string, attemptId: string): Promise<boolean> {
  return LiteRT.cancelDownload(modelId, attemptId);
}

export async function acknowledgeDownloadResult(modelId: string, attemptId: string, downloadId: number): Promise<boolean> {
  return LiteRT.acknowledgeDownloadResult(modelId, attemptId, downloadId);
}

export function downloadModel(
  modelId: string,
  url: string,
  filename: string,
  expectedSizeBytes: number,
  expectedSha256: string,
  callbacks: LiteRT.DownloadCallbacks
) {
  return LiteRT.downloadModel(modelId, url, filename, expectedSizeBytes, expectedSha256, callbacks);
}

export async function deleteModel(filename: string) {
  return LiteRT.deleteModel(filename);
}

export async function initialize(
  modelFilename: string,
  systemPrompt: string,
  serverBaseUrl: string,
  supportsVision = false,
  supportsTools = false,
  preferCpuText = false
) {
  return LiteRT.initialize(modelFilename, systemPrompt, serverBaseUrl, supportsVision, supportsTools, preferCpuText);
}

export function sendMessage(message: string, callbacks: LiteRT.StreamCallbacks) {
  return LiteRT.sendMessage(message, callbacks);
}

export function sendMessageWithImage(message: string, imagePath: string, callbacks: LiteRT.StreamCallbacks) {
  return LiteRT.sendMessageWithImage(message, imagePath, callbacks);
}

export async function resetConversation(systemPrompt: string, serverBaseUrl: string) {
  return LiteRT.resetConversation(systemPrompt, serverBaseUrl);
}

export async function destroy() {
  return LiteRT.destroy();
}
