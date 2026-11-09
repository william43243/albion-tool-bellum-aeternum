// LiteRT-LM Model Registry
// Pinned artifacts and advertised capabilities; on-device answer quality varies.

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
  /** Whether this model supports vision/multimodal */
  multimodal?: boolean;
  /** Whether LiteRT-LM tool calling is enabled for this model */
  toolCalling?: boolean;
  /** Offer an explicit Android CPU/text-only start; automatic GPU/vision stays available. */
  cpuTextOption?: boolean;
  /** Explicitly suspend unvalidated item-analysis prose for a tested artifact. */
  itemAnalysisMode?: 'calculator-only';
}

export interface AndroidModelInfo extends ModelInfoBase {
  /** Exact SHA-256 of the Android LiteRT artifact. */
  sha256: string;
}

export type ModelInfo = AndroidModelInfo;

const HF = 'https://huggingface.co/litert-community';
// Pin every Android artifact to the revision verified with its size/SHA-256.
// A mutable /resolve/main URL can change independently and fail integrity checks
// after the user has downloaded the entire model. See docs/model-download-audit.md.

export const AVAILABLE_MODELS: ModelInfo[] = [
  {
    id: 'qwen35-08b',
    name: 'Qwen3.5 0.8B',
    description: {
      fr: 'Expérimental (texte + vision). Analyses d’items calculées par l’app, chat non validé.',
      en: 'Experimental (text + vision). App-calculated item analyses; chat is unvalidated.',
      es: 'Experimental (texto + visión). Análisis de objetos calculados por la app; chat sin validar.',
    },
    filename: 'Qwen3.5-0.8B-VL_int8.litertlm',
    downloadUrl: `${HF}/Qwen3.5-0.8B/resolve/10243c0a01d24e6b122a0e814f8c4d984c9c92d6/Qwen3.5-0.8B-VL_int8.litertlm`,
    sizeBytes: 1302262448,
    sha256: 'e3360b658c929ff35ab740a21f5e4b688096a72e351b8d347e26ccda314121b7',
    sizeLabel: '1.30 GB',
    quality: 'basic',
    // GPU startup exceeded 3 GB resident+swapped on S22. Do not promise 2 GB.
    ramRequired: 'Variable (CPU / GPU)',
    license: 'Apache 2.0',
    multimodal: true,
    // This exact VL artifact's template has no tool schema/call/result format.
    // Keep direct app-provided analysis; do not advertise native tool support.
    toolCalling: false,
    cpuTextOption: true,
    itemAnalysisMode: 'calculator-only',
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
    downloadUrl: `${HF}/Qwen2.5-1.5B-Instruct/resolve/19edb84c69a0212f29a6ef17ba0d6f278b6a1614/Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm`,
    sizeBytes: 1597931520,
    sha256: 'faa60663b333290c1496c499828b21d3e3254a788cacd8cce917ce0f761a2dc9',
    sizeLabel: '1.5 GB',
    quality: 'good',
    ramRequired: '~3 GB',
    license: 'Apache 2.0',
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
    downloadUrl: `${HF}/DeepSeek-R1-Distill-Qwen-1.5B/resolve/9fd875541bb0f277e4b3cefe7d9622c4c1de2fb5/DeepSeek-R1-Distill-Qwen-1.5B_multi-prefill-seq_q8_ekv4096.litertlm`,
    sizeBytes: 1833451520,
    sha256: '69b35f01759eed765641ab4af589bbe98131fd2825662a086d9037409b8c1295',
    sizeLabel: '1.75 GB',
    quality: 'good',
    ramRequired: '~3 GB',
    license: 'MIT',
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
    downloadUrl: `${HF}/gemma-4-E2B-it-litert-lm/resolve/c658da437244f072bf2f1cabc916b60d66d97663/gemma-4-E2B-it.litertlm`,
    sizeBytes: 2588147712,
    sha256: '181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c',
    sizeLabel: '2.58 GB',
    quality: 'excellent',
    ramRequired: '~4 GB',
    license: 'Apache 2.0',

    toolCalling: true,
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
    downloadUrl: `${HF}/gemma-4-E4B-it-litert-lm/resolve/e6a3892a8c22cf87ff99583996149cf3cb32452b/gemma-4-E4B-it.litertlm`,
    sizeBytes: 3659530240,
    sha256: '0b2a8980ce155fd97673d8e820b4d29d9c7d99b8fa6806f425d969b145bd52e0',
    sizeLabel: '3.65 GB',
    quality: 'excellent',
    ramRequired: '~6 GB',
    license: 'Apache 2.0',
    toolCalling: true,
  },
];

export function getModelById(id: string): ModelInfo | undefined {
  return AVAILABLE_MODELS.find((m) => m.id === id);
}

/**
 * Get models available for the current platform.
 * Only Android artifacts are supported by this repository.
 */
export function getModelsForPlatform(platform: string): ModelInfo[] {
  return platform === 'android' ? AVAILABLE_MODELS : [];
}

/**
 * Get the filename/ID to use for this model on the current platform.
 * The pinned Android artifact filename is used.
 */
export function getModelFilename(model: ModelInfo, platform: string): string {
  return model.filename;
}

/**
 * Get the display size for this model on the current platform.
 */
export function getModelSizeLabel(model: ModelInfo, platform: string): string {
  return model.sizeLabel;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(0) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}
