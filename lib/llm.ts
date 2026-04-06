// Unified LLM Bridge — routes to LiteRT (Android) or WebLLM (Web)

import { Platform } from 'react-native';
import * as LiteRT from './litert';
import * as WebLLM from './webllm';

// Re-export types
export type { StreamCallbacks, DownloadCallbacks, DownloadedModel } from './litert';

// Pick the right engine based on platform
const isWeb = Platform.OS === 'web';

export const getDownloadedModels = isWeb ? WebLLM.getDownloadedModels : LiteRT.getDownloadedModels;
export const isModelDownloaded = isWeb ? WebLLM.isModelDownloaded : LiteRT.isModelDownloaded;
export const getFreeDiskSpace = isWeb ? WebLLM.getFreeDiskSpace : LiteRT.getFreeDiskSpace;
export const downloadModel = isWeb ? WebLLM.downloadModel : LiteRT.downloadModel;
export const deleteModel = isWeb ? WebLLM.deleteModel : LiteRT.deleteModel;
export const initialize = isWeb ? WebLLM.initialize : LiteRT.initialize;
export const sendMessage = isWeb ? WebLLM.sendMessage : LiteRT.sendMessage;
export const sendMessageWithImage = isWeb ? WebLLM.sendMessageWithImage : LiteRT.sendMessageWithImage;
export const resetConversation = isWeb ? WebLLM.resetConversation : LiteRT.resetConversation;
export const destroy = isWeb ? WebLLM.destroy : LiteRT.destroy;

// Web-only: WebGPU check
export const isWebGPUAvailable = WebLLM.isWebGPUAvailable;
