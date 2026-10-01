// LiteRT-LM Model Registry
// Only verified working + ungated models

interface ModelInfoBase {
  id: string;
  name: string;
  description: Record<string, string>;
  filename: string;
  downloadUrl: string;
  sizeBytes: number;

  sizeLabel: string;
  quality: 'basic' | 'good' | 'excellent';
  ramRequired: string;
  license: string;
  /** WebLLM model ID for browser — if set, this model works on web too */
  webModelId?: string;
  /** Web-specific size label (MLC format differs from LiteRT) */
  webSizeLabel?: string;
  /** Whether this model supports vision/multimodal */
  multimodal?: boolean;
  /** Whether LiteRT-LM tool calling is enabled for this model */
  toolCalling?: boolean;
}

export interface AndroidModelInfo extends ModelInfoBase {
  /** Exact SHA-256 of the Android LiteRT artifact. */
  sha256: string;
  webOnly?: false;
}

export interface WebOnlyModelInfo extends ModelInfoBase {
  sha256?: never;
  webOnly: true;
}

export type ModelInfo = AndroidModelInfo | WebOnlyModelInfo;

const HF = 'https://huggingface.co/litert-community';

export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    id: 'qwen35-08b',
    name: 'Qwen3.5 0.8B',
    description: {
      fr: 'Léger et multimodal (texte + vision). Réponses rapides.',
      en: 'Light and multimodal (text + vision). Fast responses.',
      es: 'Ligero y multimodal (texto + visión). Respuestas rápidas.',
    },
    filename: 'Qwen3.5-0.8B-VL_int8.litertlm',
    downloadUrl: `${HF}/Qwen3.5-0.8B/resolve/main/Qwen3.5-0.8B-VL_int8.litertlm`,
    sizeBytes: 1302262448,
    sha256: 'e3360b658c929ff35ab740a21f5e4b688096a72e351b8d347e26ccda314121b7',
    sizeLabel: '1.30 GB',
    quality: 'basic',
    ramRequired: '~2 GB',
    license: 'Apache 2.0',
    multimodal: true,
    toolCalling: true,
  },
  {
    id: 'qwen25-15b',
    name: 'Qwen2.5 1.5B',
    description: {
      fr: 'Bon compromis taille/qualité. Solide pour l\'analyse de marché.',
      en: 'Good size/quality tradeoff. Solid for market analysis.',
      es: 'Buen equilibrio tamaño/calidad. Sólido para análisis de mercado.',
    },
    filename: 'Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm',
    downloadUrl: `${HF}/Qwen2.5-1.5B-Instruct/resolve/main/Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm`,
    sizeBytes: 1597931520,
    sha256: 'faa60663b333290c1496c499828b21d3e3254a788cacd8cce917ce0f761a2dc9',
    sizeLabel: '1.5 GB',
    quality: 'good',
    ramRequired: '~3 GB',
    license: 'Apache 2.0',
    webModelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    webSizeLabel: '~900 MB',
  },
  {
    id: 'deepseek-r1-15b',
    name: 'DeepSeek R1 1.5B',
    description: {
      fr: 'Spécialisé raisonnement. Bon pour tendances et calculs.',
      en: 'Reasoning specialist. Good for trends and calculations.',
      es: 'Especialista en razonamiento. Bueno para tendencias y cálculos.',
    },
    filename: 'DeepSeek-R1-Distill-Qwen-1.5B_multi-prefill-seq_q8_ekv4096.litertlm',
    downloadUrl: `${HF}/DeepSeek-R1-Distill-Qwen-1.5B/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B_multi-prefill-seq_q8_ekv4096.litertlm`,
    sizeBytes: 1833451520,
    sha256: '69b35f01759eed765641ab4af589bbe98131fd2825662a086d9037409b8c1295',
    sizeLabel: '1.75 GB',
    quality: 'good',
    ramRequired: '~3 GB',
    license: 'MIT',
    // DeepSeek R1 1.5B not available in WebLLM (only 7B+)
  },
  {
    id: 'gemma4-e2b',
    name: 'Gemma 4 E2B',
    description: {
      fr: 'Recommandé. Meilleur support du tool calling et analyses précises.',
      en: 'Recommended. Best tool calling support and precise analysis.',
      es: 'Recomendado. Mejor soporte de tool calling y análisis precisos.',
    },
    filename: 'gemma-4-E2B-it.litertlm',
    downloadUrl: `${HF}/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm`,
    sizeBytes: 2588147712,
    sha256: '181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c',
    sizeLabel: '2.58 GB',
    quality: 'excellent',
    ramRequired: '~4 GB',
    license: 'Gemma',
    toolCalling: true,
    webModelId: 'gemma-2-2b-it-q4f16_1-MLC',
    webSizeLabel: '~1.4 GB',
  },
  {
    id: 'gemma4-e4b',
    name: 'Gemma 4 E4B',
    description: {
      fr: 'Le plus performant. Analyses les plus précises. Haut de gamme requis.',
      en: 'Most powerful. Most accurate analysis. High-end phone required.',
      es: 'El más potente. Análisis más precisos. Teléfono de gama alta.',
    },
    filename: 'gemma-4-E4B-it.litertlm',
    downloadUrl: `${HF}/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it.litertlm`,
    sizeBytes: 3659530240,
    sha256: '0b2a8980ce155fd97673d8e820b4d29d9c7d99b8fa6806f425d969b145bd52e0',
    sizeLabel: '3.65 GB',
    quality: 'excellent',
    ramRequired: '~6 GB',
    license: 'Gemma',
    toolCalling: true,
  },
  // ─── Web-only models (too large for mobile, great on PC) ────
  {
    id: 'qwen25-7b-web',
    name: 'Qwen2.5 7B',
    description: {
      fr: 'Puissant. Excellent raisonnement et tool calling. Web uniquement.',
      en: 'Powerful. Excellent reasoning and tool calling. Web only.',
      es: 'Potente. Excelente razonamiento y tool calling. Solo web.',
    },
    filename: 'Qwen2.5-7B-Instruct-q4f16_1-MLC',
    downloadUrl: '',
    sizeBytes: 4.5 * 1024 * 1024 * 1024,
    sizeLabel: '~4.5 GB',
    quality: 'excellent',
    ramRequired: '~6 GB VRAM',
    license: 'Apache 2.0',
    webModelId: 'Qwen2.5-7B-Instruct-q4f16_1-MLC',
    webSizeLabel: '~4.5 GB',
    webOnly: true,
  },
  {
    id: 'phi35-mini-web',
    name: 'Phi-3.5 Mini 3.8B',
    description: {
      fr: 'Microsoft. Compact et performant. Ideal pour le web.',
      en: 'Microsoft. Compact and capable. Ideal for web.',
      es: 'Microsoft. Compacto y capaz. Ideal para web.',
    },
    filename: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
    downloadUrl: '',
    sizeBytes: 2.2 * 1024 * 1024 * 1024,
    sizeLabel: '~2.2 GB',
    quality: 'excellent',
    ramRequired: '~4 GB VRAM',
    license: 'MIT',
    webModelId: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
    webSizeLabel: '~2.2 GB',
    webOnly: true,
  },
  {
    id: 'llama32-3b-web',
    name: 'Llama 3.2 3B',
    description: {
      fr: 'Meta. Tres bon equilibre performance/vitesse. Web uniquement.',
      en: 'Meta. Great balance of performance/speed. Web only.',
      es: 'Meta. Gran equilibrio rendimiento/velocidad. Solo web.',
    },
    filename: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    downloadUrl: '',
    sizeBytes: 1.8 * 1024 * 1024 * 1024,
    sizeLabel: '~1.8 GB',
    quality: 'good',
    ramRequired: '~3 GB VRAM',
    license: 'Llama 3.2',
    webModelId: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    webSizeLabel: '~1.8 GB',
    webOnly: true,
  },
];

export function getModelById(id: string): ModelInfo | undefined {
  return AVAILABLE_MODELS.find((m) => m.id === id);
}

/**
 * Get models available for the current platform.
 * Android: models with a .litertlm filename (excludes webOnly)
 * Web: models with a webModelId set
 */
export function getModelsForPlatform(platform: string): ModelInfo[] {
  if (platform === 'web') {
    return AVAILABLE_MODELS.filter((m) => !!m.webModelId);
  }
  // Android/iOS — exclude web-only models
  return AVAILABLE_MODELS.filter((m) => !m.webOnly);
}

/**
 * Get the filename/ID to use for this model on the current platform.
 * Web uses webModelId, Android uses filename.
 */
export function getModelFilename(model: ModelInfo, platform: string): string {
  if (platform === 'web' && model.webModelId) return model.webModelId;
  return model.filename;
}

/**
 * Get the display size for this model on the current platform.
 */
export function getModelSizeLabel(model: ModelInfo, platform: string): string {
  if (platform === 'web' && model.webSizeLabel) return model.webSizeLabel;
  return model.sizeLabel;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(0) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}
