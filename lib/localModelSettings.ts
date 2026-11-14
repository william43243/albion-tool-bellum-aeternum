/** Local-only inference settings. Null context selects the application's auto request. */
export interface LocalModelSettings {
  contextTokens: number | null;
  autoCompress: boolean;
  topK: number;
  topP: number;
  temperature: number;
  preferCpuText: boolean;
}

export const DEFAULT_LOCAL_MODEL_SETTINGS: LocalModelSettings = {
  contextTokens: null,
  autoCompress: true,
  topK: 20,
  topP: 0.9,
  temperature: 0.3,
  preferCpuText: false,
};

/** The model's advertised limit may be lower than the general UI range. */
export function validateLocalModelSettings(value: LocalModelSettings, modelMaxContext?: number): string | null {
  const { contextTokens, topK, topP, temperature } = value;
  if (contextTokens !== null && (!Number.isInteger(contextTokens) || contextTokens < 2000 || contextTokens > 32000 || (modelMaxContext !== undefined && contextTokens > modelMaxContext))) return 'contextTokens';
  if (!Number.isInteger(topK) || topK < 1 || topK > 100) return 'topK';
  if (!Number.isFinite(topP) || topP < 0 || topP > 1) return 'topP';
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) return 'temperature';
  if (typeof value.autoCompress !== 'boolean' || typeof value.preferCpuText !== 'boolean') return 'flags';
  return null;
}

/** Discard corrupted/old persisted settings instead of passing them to JNI. */
export function sanitizeLocalModelSettings(value: unknown, modelMaxContext?: number): LocalModelSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_LOCAL_MODEL_SETTINGS };
  const result = { ...DEFAULT_LOCAL_MODEL_SETTINGS, ...value } as LocalModelSettings;
  return validateLocalModelSettings(result, modelMaxContext) ? { ...DEFAULT_LOCAL_MODEL_SETTINGS } : result;
}
