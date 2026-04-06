// WebLLM Engine Bridge — runs LLMs in the browser via WebGPU
// Mirrors the litert.ts API so AdvisorScreen can use either seamlessly

import { Platform } from 'react-native';

// Lazy-loaded to avoid bundling on Android
let webllm: typeof import('@mlc-ai/web-llm') | null = null;
let engine: any = null;
let currentSystemPrompt = '';
let conversationHistory: Array<{ role: string; content: string }> = [];

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

// ─── WebGPU Detection ─────────────────────────────────────────

export async function isWebGPUAvailable(): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  try {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
    const adapter = await (navigator as any).gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

async function getWebLLM() {
  if (!webllm) {
    webllm = await import('@mlc-ai/web-llm');
  }
  return webllm;
}

// ─── Model Management ────────────────────────────────────────

/**
 * On web, we check the real WebLLM cache — not localStorage.
 * hasModelInCache is the source of truth.
 */
export async function getDownloadedModels(): Promise<DownloadedModel[]> {
  if (Platform.OS !== 'web') return [];
  // On web, models are checked individually via isModelDownloaded
  // Return empty — AdvisorScreen uses isModelDownloaded per-model instead
  return [];
}

export async function isModelDownloaded(filename: string): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  try {
    const wllm = await getWebLLM();
    return await wllm.hasModelInCache(filename);
  } catch {
    return false;
  }
}

export async function getFreeDiskSpace(): Promise<number> {
  if (Platform.OS !== 'web') return -1;
  try {
    if ('storage' in navigator && 'estimate' in (navigator as any).storage) {
      const est = await (navigator as any).storage.estimate();
      return (est.quota || 0) - (est.usage || 0);
    }
  } catch {}
  return -1;
}

/**
 * On web, download and init are the same operation.
 * CreateMLCEngine downloads to cache + initializes GPU in one step.
 * We store the engine so `initialize()` can reuse it.
 */
let pendingEngine: any = null;
let pendingModelId: string | null = null;

export function downloadModel(
  modelId: string,
  _url: string,
  filename: string,     // this is the webModelId
  callbacks: DownloadCallbacks
): { promise: Promise<{ path: string; sizeBytes: number }>; cancel: () => void } {
  let cancelled = false;

  const promise = (async () => {
    const wllm = await getWebLLM();

    // Destroy any previous engine
    if (engine) {
      try { await engine.unload(); } catch {}
      engine = null;
    }
    if (pendingEngine) {
      try { await pendingEngine.unload(); } catch {}
      pendingEngine = null;
    }

    // CreateMLCEngine downloads + inits in one step
    const newEngine = await wllm.CreateMLCEngine(filename, {
      initProgressCallback: (progress: any) => {
        if (cancelled) return;
        const pct = Math.round((progress.progress || 0) * 100);
        callbacks.onProgress(pct, 100, pct);
      },
    });

    if (cancelled) {
      await newEngine.unload();
      throw new Error('cancelled');
    }

    // Store engine for reuse in initialize()
    pendingEngine = newEngine;
    pendingModelId = filename;

    return { path: 'cache', sizeBytes: 0 };
  })();

  return {
    promise,
    cancel: () => { cancelled = true; },
  };
}

export async function deleteModel(filename: string): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  try {
    const wllm = await getWebLLM();
    await wllm.deleteModelAllInfoInCache(filename);
    return true;
  } catch {
    return false;
  }
}

// ─── Engine Lifecycle ────────────────────────────────────────

export async function initialize(
  modelFilename: string,  // this is the webModelId
  systemPrompt: string,
  _serverBaseUrl: string
): Promise<boolean> {
  if (Platform.OS !== 'web') {
    throw new Error('WebLLM is only available on web');
  }

  const wllm = await getWebLLM();

  currentSystemPrompt = systemPrompt;
  conversationHistory = [{ role: 'system', content: systemPrompt }];

  // Reuse engine from downloadModel if same model
  if (pendingEngine && pendingModelId === modelFilename) {
    engine = pendingEngine;
    pendingEngine = null;
    pendingModelId = null;
    return true;
  }

  // Otherwise init from cache (model already downloaded)
  if (engine) {
    try { await engine.unload(); } catch {}
    engine = null;
  }

  engine = await wllm.CreateMLCEngine(modelFilename, {
    initProgressCallback: () => {},
  });

  return true;
}

export function sendMessage(
  message: string,
  callbacks: StreamCallbacks
): () => void {
  if (!engine) {
    callbacks.onError('WebLLM engine not initialized');
    return () => {};
  }

  let cancelled = false;

  conversationHistory.push({ role: 'user', content: message });

  (async () => {
    try {
      const reply = await engine.chat.completions.create({
        messages: conversationHistory as any,
        stream: true,
        temperature: 0.3,
        max_tokens: 512,
      });

      let fullResponse = '';

      for await (const chunk of reply) {
        if (cancelled) break;
        const delta = chunk.choices?.[0]?.delta?.content || '';
        if (delta) {
          fullResponse += delta;
          callbacks.onToken(delta);
        }
      }

      if (!cancelled) {
        conversationHistory.push({ role: 'assistant', content: fullResponse });
        callbacks.onDone();
      }
    } catch (err: any) {
      if (!cancelled) {
        callbacks.onError(err?.message || String(err));
      }
    }
  })();

  return () => { cancelled = true; };
}

/**
 * Vision not supported on WebLLM — fallback to text-only
 */
export function sendMessageWithImage(
  message: string,
  _imagePath: string,
  callbacks: StreamCallbacks
): () => void {
  return sendMessage(`[Image attached but vision not available on web] ${message}`, callbacks);
}

export async function resetConversation(systemPrompt: string): Promise<boolean> {
  if (!engine) return false;
  currentSystemPrompt = systemPrompt;
  conversationHistory = [{ role: 'system', content: systemPrompt }];
  try {
    await engine.resetChat();
  } catch {}
  return true;
}

export async function destroy(): Promise<boolean> {
  if (!engine) return false;
  try {
    await engine.unload();
  } catch {}
  engine = null;
  conversationHistory = [];
  return true;
}
