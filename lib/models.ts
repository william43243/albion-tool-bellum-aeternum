// LiteRT-LM Model Registry
// Only verified working + ungated models

export interface ModelInfo {
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
}

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
    filename: 'model_multimodal.litertlm',
    downloadUrl: `${HF}/Qwen3.5-0.8B-LiteRT/resolve/main/model_multimodal.litertlm`,
    sizeBytes: 1.07 * 1024 * 1024 * 1024,
    sizeLabel: '1.07 GB',
    quality: 'basic',
    ramRequired: '~2 GB',
    license: 'Apache 2.0',
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
    sizeBytes: 1.5 * 1024 * 1024 * 1024,
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
    downloadUrl: `${HF}/DeepSeek-R1-Distill-Qwen-1.5B/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B_multi-prefill-seq_q8_ekv4096.litertlm`,
    sizeBytes: 1.75 * 1024 * 1024 * 1024,
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
    downloadUrl: `${HF}/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm`,
    sizeBytes: 2.58 * 1024 * 1024 * 1024,
    sizeLabel: '2.58 GB',
    quality: 'excellent',
    ramRequired: '~4 GB',
    license: 'Gemma',
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
    sizeBytes: 3.65 * 1024 * 1024 * 1024,
    sizeLabel: '3.65 GB',
    quality: 'excellent',
    ramRequired: '~6 GB',
    license: 'Gemma',
  },
];

export function getModelById(id: string): ModelInfo | undefined {
  return AVAILABLE_MODELS.find((m) => m.id === id);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(0) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}
