import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Alert,
  AppState,
} from 'react-native';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';
import { Language } from '../lib/i18n';
import { Server, City } from '../lib/api';
import { parseMarketQuery } from '../lib/marketQuery';
import { AlbionItem } from '../lib/items';
import ItemPicker from '../components/ItemPicker';
import {
  buildSystemPrompt,
  buildAnalysisPrompt,
  buildQuestionPrompt,
  fetchMarketContext,
  MarketContext,
} from '../lib/advisor';
import { SERVERS } from '../lib/api';
import * as LLM from '../lib/llm';
import * as ImagePicker from 'expo-image-picker';
import { AVAILABLE_MODELS, ModelInfo, formatBytes, getModelsForPlatform, getModelFilename, getModelSizeLabel, getModelById } from '../lib/models';
import { captureAnalyticsAuthorization, trackAIPrompt, trackAIModelDownload, trackAIModelStart, trackAIImageSent } from '../lib/analytics';
import { shouldCancelDownload } from '../lib/downloadLifecycle';
import { createAdvisorSession } from '../lib/advisorSession';
import { getMarketplaceFeeAnswer } from '../lib/advisorFees';
import { evaluateAdvisorDecision, formatAdvisorDecision } from '../lib/advisorDecision';

interface Props {
  t: (key: any) => any;
  lang: Language;
  server: Server;
  playerCity: City | null;
  onCityDetected?: (city: City) => Promise<void>;
  isPremium: boolean;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  source?: 'model' | 'calculator';
}

type Screen = 'models' | 'chat';
type EngineState = 'idle' | 'loading' | 'ready' | 'error';

interface DownloadState {
  modelId: string;
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
}

export default function AdvisorScreen({ t, lang, server, playerCity, onCityDetected, isPremium }: Props) {
  const [screen, setScreen] = useState<Screen>('models');
  const [engineState, setEngineState] = useState<EngineState>('idle');
  const [downloadedFilenames, setDownloadedFilenames] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState<DownloadState | null>(null);
  const [blockedTerminalModelId, setBlockedTerminalModelId] = useState<string | null>(null);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [freeDisk, setFreeDisk] = useState<number>(-1);
  const [webGPUSupported, setWebGPUSupported] = useState<boolean | null>(
    Platform.OS === 'web' ? false : null
  );
  const [backendInfo, setBackendInfo] = useState<{ backendUsed: string; isMediaTek: boolean; hasVision: boolean; maxOutputTokens?: number } | null>(null);
  const isWeb = Platform.OS === 'web';
  const calculatorOnlyAnalysis = getModelById(activeModelId || '')?.itemAnalysisMode === 'calculator-only';
  const unverifiedAIWarning = lang === 'fr'
    ? 'Chat IA expérimental : réponse non validée, pouvant contredire les calculs. Ne pas utiliser comme recommandation de trade.'
    : lang === 'es'
    ? 'Chat IA experimental: respuesta sin validar, puede contradecir los cálculos. No usar como recomendación comercial.'
    : 'Experimental AI chat: unvalidated output can contradict calculations. Do not use it as a trade recommendation.';

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const streamTextRef = useRef('');
  const [selectedItem, setSelectedItem] = useState<AlbionItem | null>(null);
  const [marketCtx, setMarketCtx] = useState<MarketContext | null>(null);
  const [fetchingData, setFetchingData] = useState(false);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [tokenCount, setTokenCount] = useState(0);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const cancelDownloadRef = useRef<(() => Promise<boolean>) | null>(null);
  const applyActiveDownloadRef = useRef<((active: Awaited<ReturnType<typeof LLM.getActiveDownload>>) => void) | null>(null);
  const currentDownloadAttemptRef = useRef<string | null>(null);
  const retiredDownloadAttemptsRef = useRef(new Set<string>());
  const acknowledgementInFlightRef = useRef(new Map<string, Promise<void>>());
  const terminalProcessingInFlightRef = useRef(new Map<string, Promise<void>>());
  const downloadRecoveryAlertVisibleRef = useRef(false);
  const latestDownloadStateRef = useRef<{ downloadId: number; terminal: boolean } | null>(null);
  const previousServerRef = useRef<Server>(server);
  const resetInFlightRef = useRef<Promise<boolean> | null>(null);
  const resetSessionRef = useRef<number | null>(null);
  const advisorSession = useRef(createAdvisorSession(server)).current;
  advisorSession.configure(server);
  const renderSession = advisorSession.capture();
  const renderRequest = advisorSession.captureRequest();
  const renderStream = advisorSession.captureStream();
  const activeModelRef = useRef(activeModelId);
  activeModelRef.current = activeModelId;
  const modelAttemptRef = useRef(0);
  const initializedModelRef = useRef<string | null>(null);
  const premiumRef = useRef(isPremium);
  premiumRef.current = isPremium;

  // ~4 chars per token is a rough estimate for English/French
  const MAX_TOKENS = 4096;
  const SYSTEM_PROMPT_TOKENS = Math.ceil(buildSystemPrompt(lang, server).length / 4); // estimate, not tokenizer output
  const WARNING_THRESHOLD = MAX_TOKENS * 0.75; // warn at 75%
  const RESET_THRESHOLD = MAX_TOKENS * 0.90;   // auto-reset at 90%

  const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

  const clearSessionContext = useCallback(() => {
    const session = advisorSession.invalidate();
    cleanupRef.current?.();
    cleanupRef.current = null;
    setStreaming(false);
    setStreamBuffer('');
    streamTextRef.current = '';
    setMarketCtx(null);
    setSelectedItem(null);
    setFetchingData(false);
    setShowItemPicker(false);
    setTokenCount(SYSTEM_PROMPT_TOKENS);
    return session;
  }, [advisorSession, SYSTEM_PROMPT_TOKENS]);

  const resetNativeConversation = useCallback(async (): Promise<boolean> => {
    if (!advisorSession.matchesServer(server)) return false;
    const session = advisorSession.capture();
    if (resetSessionRef.current === session && resetInFlightRef.current) return resetInFlightRef.current;
    advisorSession.suspend();
    setEngineState('loading');
    const pending = advisorSession.enqueue(async () => {
      if (!advisorSession.isCurrent(session)) return false;
      if (!activeModelRef.current || initializedModelRef.current !== activeModelRef.current) {
        throw new Error('The selected AI model did not finish initializing. Start it again.');
      }
      return LLM.resetConversation(buildSystemPrompt(lang, server), SERVERS[server]);
    }).then((success) => {
      if (!advisorSession.isCurrent(session)) return false;
      if (!success) throw new Error('Could not reset the AI conversation');
      advisorSession.markReady(session);
      setEngineState('ready');
      setScreen('chat');
      return true;
    }).catch((error) => {
      if (advisorSession.isCurrent(session)) {
        setEngineState('error');
        Alert.alert(t('error'), error?.message || String(error));
      }
      return false;
    }).finally(() => {
      if (resetInFlightRef.current === pending) {
        resetInFlightRef.current = null;
        resetSessionRef.current = null;
      }
    });
    resetInFlightRef.current = pending;
    resetSessionRef.current = session;
    return pending;
  }, [advisorSession, lang, server, t]);

  // Load downloaded models on mount + refresh when app comes back to foreground
  useEffect(() => {
    let mounted = true;
    const applyActiveDownload = (active: Awaited<ReturnType<typeof LLM.getActiveDownload>>) => {
      if (!mounted) return;
      if (!active) return;
      if (retiredDownloadAttemptsRef.current.has(active.attemptId)) return;
      const terminal = active.status === 'complete' || active.status === 'failed';
      if (currentDownloadAttemptRef.current && currentDownloadAttemptRef.current !== active.attemptId) return;
      const previous = latestDownloadStateRef.current;
      if (previous && (
        active.downloadId < previous.downloadId ||
        (active.downloadId === previous.downloadId && previous.terminal && !terminal)
      )) return;
      const isNewTerminal = terminal && (!previous || previous.downloadId !== active.downloadId || !previous.terminal);
      latestDownloadStateRef.current = { downloadId: active.downloadId, terminal };
      currentDownloadAttemptRef.current = active.attemptId;

      const acknowledge = (): Promise<void> => {
        const acknowledgementKey = `${active.attemptId}:${active.downloadId}`;
        const inFlight = acknowledgementInFlightRef.current.get(acknowledgementKey);
        if (inFlight) return inFlight;

        const pending = LLM.acknowledgeDownloadResult(active.modelId, active.attemptId, active.downloadId)
          .then(async (acknowledged) => {
            if (!acknowledged) {
              const current = await LLM.getActiveDownload();
              if (current && current.attemptId === active.attemptId && current.downloadId === active.downloadId) {
                throw new Error('Download result still exists but could not be acknowledged');
              }
            }
            retiredDownloadAttemptsRef.current.add(active.attemptId);
            if (currentDownloadAttemptRef.current === active.attemptId) currentDownloadAttemptRef.current = null;
            setBlockedTerminalModelId(null);
          })
          .catch(() => {
            if (!mounted) return;
            Alert.alert(
              t('error'),
              lang === 'fr' ? 'Impossible de confirmer le résultat. Réessayez.' : lang === 'es' ? 'No se pudo confirmar el resultado. Inténtalo de nuevo.' : 'Could not acknowledge the result. Try again.',
              [{
                text: lang === 'fr' ? 'Réessayer' : lang === 'es' ? 'Reintentar' : 'Retry',
                onPress: () => active.status === 'complete' ? verifyCompleteAndAcknowledge() : void acknowledge(),
              }],
              { cancelable: false },
            );
          })
          .finally(() => {
            if (acknowledgementInFlightRef.current.get(acknowledgementKey) === pending) {
              acknowledgementInFlightRef.current.delete(acknowledgementKey);
            }
          });
        acknowledgementInFlightRef.current.set(acknowledgementKey, pending);
        return pending;
      };

      const verifyCompleteAndAcknowledge = (): Promise<void> => {
        const processingKey = `${active.attemptId}:${active.downloadId}`;
        const existing = terminalProcessingInFlightRef.current.get(processingKey);
        if (existing) return existing;
        const pending = refreshDownloadedModels()
          .then((verified) => {
            if (!verified.has(active.filename)) {
              throw new Error('Promoted model is not verified as ready');
            }
            return acknowledge();
          })
          .catch(() => {
            if (!mounted || downloadRecoveryAlertVisibleRef.current) return;
            downloadRecoveryAlertVisibleRef.current = true;
            Alert.alert(
              t('error'),
              lang === 'fr'
                ? "Le modèle téléchargé n’est pas vérifié. Le résultat est conservé; réessayez."
                : lang === 'es'
                ? 'El modelo descargado no está verificado. El resultado se conserva; reinténtalo.'
                : 'The downloaded model is not verified. The result is preserved; try again.',
              [
                { text: lang === 'fr' ? 'Réessayer' : lang === 'es' ? 'Reintentar' : 'Retry', onPress: () => { downloadRecoveryAlertVisibleRef.current = false; void verifyCompleteAndAcknowledge(); } },
              ],
              { cancelable: false },
            );
          })
          .finally(() => {
            if (terminalProcessingInFlightRef.current.get(processingKey) === pending) {
              terminalProcessingInFlightRef.current.delete(processingKey);
            }
          });
        terminalProcessingInFlightRef.current.set(processingKey, pending);
        return pending;
      };

      if (terminal) {
        setDownloading(null);
        cancelDownloadRef.current = null;
        if (active.status === 'complete') {
          setBlockedTerminalModelId(active.modelId);
          void verifyCompleteAndAcknowledge();
        } else if (isNewTerminal) {
          Alert.alert(
            t('error'),
            lang === 'fr' ? 'Le téléchargement du modèle a échoué.' : lang === 'es' ? 'La descarga del modelo falló.' : 'The model download failed.',
            [{ text: 'OK', onPress: acknowledge }],
          );
        }
        return;
      }
      setDownloading({
        modelId: active.modelId,
        percent: active.percent,
        bytesDownloaded: active.bytesDownloaded,
        totalBytes: active.totalBytes,
      });
      cancelDownloadRef.current = () => LLM.cancelDownload(active.modelId, active.attemptId);
    };
    applyActiveDownloadRef.current = applyActiveDownload;
    const showDownloadRecoveryError = () => {
      if (!mounted || downloadRecoveryAlertVisibleRef.current) return;
      downloadRecoveryAlertVisibleRef.current = true;
      Alert.alert(
        t('error'),
        lang === 'fr'
          ? "Impossible de restaurer l’état du téléchargement. Réessayez; si l’erreur persiste, redémarrez l’application."
          : lang === 'es'
          ? 'No se pudo restaurar el estado de la descarga. Reinténtalo; si el error persiste, reinicia la aplicación.'
          : 'Could not restore download state. Retry; if the error persists, restart the app.',
        [
          { text: lang === 'fr' ? 'Réessayer' : lang === 'es' ? 'Reintentar' : 'Retry', onPress: syncActiveDownload },
          { text: 'OK', onPress: () => { downloadRecoveryAlertVisibleRef.current = false; } },
        ],
      );
    };
    function syncActiveDownload() {
      downloadRecoveryAlertVisibleRef.current = false;
      void LLM.getActiveDownload().then(applyActiveDownload).catch(showDownloadRecoveryError);
    }

    refreshDownloadedModels();
    LLM.getFreeDiskSpace().then(setFreeDisk);
    const stopObservingDownload = LLM.observeDownloadProgress(applyActiveDownload);
    syncActiveDownload();

    // Check WebGPU on web
    if (Platform.OS === 'web') {
      LLM.isWebGPUAvailable().then(setWebGPUSupported);
    }

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshDownloadedModels();
        LLM.getFreeDiskSpace().then(setFreeDisk);
        syncActiveDownload();
      }
    });
    return () => {
      mounted = false;
      applyActiveDownloadRef.current = null;
      stopObservingDownload();
      sub.remove();
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages, streamBuffer]);

  const refreshDownloadedModels = async () => {
    const platformModels = getModelsForPlatform(Platform.OS);
    const verified = new Set<string>();
    for (const model of platformModels) {
      const filename = getModelFilename(model, Platform.OS);
      const isDownloaded = await LLM.isModelDownloaded(filename, model.sizeBytes, model.sha256 ?? '');
      if (isDownloaded) verified.add(filename);
    }
    setDownloadedFilenames(verified);
    return verified;
  };

  // ─── Model Download ──────────────────────────────────────────

  const handleDownload = useCallback(
    (model: ModelInfo) => {
      if (downloading || currentDownloadAttemptRef.current) return;
      const analyticsAuthorization = captureAnalyticsAuthorization();

      // Check disk space
      if (freeDisk > 0 && model.sizeBytes > freeDisk * 0.9) {
        Alert.alert(
          t('error'),
          lang === 'fr'
            ? `Espace disque insuffisant. Requis: ${model.sizeLabel}, Disponible: ${formatBytes(freeDisk)}`
            : `Not enough disk space. Required: ${model.sizeLabel}, Available: ${formatBytes(freeDisk)}`
        );
        return;
      }

      setDownloading({ modelId: model.id, percent: 0, bytesDownloaded: 0, totalBytes: model.sizeBytes });

      try {
        const dlFilename = getModelFilename(model, Platform.OS);
        const { attemptId, promise, cancel } = LLM.downloadModel(
          model.id,
          model.downloadUrl,
          dlFilename,
          model.sizeBytes,
          model.sha256 ?? '',
          {
            onProgress: (bytesDownloaded, totalBytes, percent) => {
              if (currentDownloadAttemptRef.current !== attemptId) return;
              setDownloading((prev) =>
                prev ? { ...prev, bytesDownloaded, totalBytes, percent } : null
              );
            },
          }
        );

        currentDownloadAttemptRef.current = attemptId;
        cancelDownloadRef.current = () => {
          if (currentDownloadAttemptRef.current !== attemptId) return Promise.resolve(false);
          return cancel();
        };

        promise
          .then(async function reconcileCompletedDownload() {
            if (currentDownloadAttemptRef.current !== attemptId) return;
            if (Platform.OS === 'web') {
              currentDownloadAttemptRef.current = null;
              setDownloading(null);
              await refreshDownloadedModels();
              LLM.getFreeDiskSpace().then(setFreeDisk);
              trackAIModelDownload(model.id, analyticsAuthorization);
              return;
            }
            const durable = await LLM.getActiveDownload().catch(() => null);
            if (currentDownloadAttemptRef.current !== attemptId) return;
            if (durable?.attemptId === attemptId && durable.status === 'complete') {
              applyActiveDownloadRef.current?.(durable);
              LLM.getFreeDiskSpace().then(setFreeDisk);
              trackAIModelDownload(model.id, analyticsAuthorization);
              return;
            }
            Alert.alert(
              t('error'),
              lang === 'fr'
                ? 'Impossible de confirmer le téléchargement terminé. Réessayez.'
                : lang === 'es'
                ? 'No se pudo confirmar la descarga completada. Inténtalo de nuevo.'
                : 'Could not confirm the completed download. Try again.',
              [{
                text: lang === 'fr' ? 'Réessayer' : lang === 'es' ? 'Reintentar' : 'Retry',
                onPress: () => void reconcileCompletedDownload(),
              }],
            );
          })
          .catch(async (err: any) => {
            if (currentDownloadAttemptRef.current !== attemptId) return;
            if (err?.code === 'DOWNLOAD_CANCELLED') return;
            if (err?.code === 'DOWNLOAD_FAILED' || err?.code === 'DOWNLOAD_INTEGRITY_ERROR') {
              const reconcileFailedDownload = async (): Promise<void> => {
                if (currentDownloadAttemptRef.current !== attemptId) return;
                const durable = await LLM.getActiveDownload().catch(() => null);
                if (currentDownloadAttemptRef.current !== attemptId) return;
                if (durable?.attemptId === attemptId && durable.status === 'failed') {
                  applyActiveDownloadRef.current?.(durable);
                  return;
                }

                setDownloading(null);
                cancelDownloadRef.current = null;
                Alert.alert(
                  t('error'),
                  lang === 'fr'
                    ? 'Impossible de récupérer le résultat du téléchargement échoué. Réessayez.'
                    : lang === 'es'
                    ? 'No se pudo recuperar el resultado de la descarga fallida. Inténtalo de nuevo.'
                    : 'Could not retrieve the failed download result. Try again.',
                  [{
                    text: lang === 'fr' ? 'Réessayer' : lang === 'es' ? 'Reintentar' : 'Retry',
                    onPress: () => void reconcileFailedDownload(),
                  }],
                );
              };
              await reconcileFailedDownload();
              return;
            }
            setDownloading(null);
            cancelDownloadRef.current = null;
            currentDownloadAttemptRef.current = null;
            const msg = err?.message || String(err) || 'Unknown error';
            if (!msg.includes('cancelled')) {
              Alert.alert(t('error'), msg);
            }
          });
      } catch (err: any) {
        setDownloading(null);
        cancelDownloadRef.current = null;
        Alert.alert(t('error'), err?.message || String(err));
      }
    },
    [downloading, freeDisk, lang, t]
  );

  const handleCancelDownload = useCallback(() => {
    if (!shouldCancelDownload('explicit-cancel')) return;
    const cancel = cancelDownloadRef.current;
    const attemptId = currentDownloadAttemptRef.current;
    if (!cancel || !attemptId) return;
    void cancel()
      .then((cancelled) => {
        if (!cancelled) throw new Error('Download cancellation was not accepted');
        if (currentDownloadAttemptRef.current !== attemptId) return;
        retiredDownloadAttemptsRef.current.add(attemptId);
        currentDownloadAttemptRef.current = null;
        cancelDownloadRef.current = null;
        setDownloading(null);
      })
      .catch((error) => {
        if (currentDownloadAttemptRef.current !== attemptId) return;
        Alert.alert(t('error'), error?.message || String(error));
      });
  }, [t]);

  const handleDeleteModel = useCallback(
    async (model: ModelInfo) => {
      if (blockedTerminalModelId === model.id) {
        Alert.alert(
          t('error'),
          lang === 'fr' ? 'Confirmez d’abord le téléchargement conservé.' : lang === 'es' ? 'Confirma primero la descarga conservada.' : 'Confirm the retained download first.',
        );
        return;
      }
      Alert.alert(
        lang === 'fr' ? 'Supprimer le modèle ?' : 'Delete model?',
        model.name,
        [
          { text: lang === 'fr' ? 'Annuler' : 'Cancel', style: 'cancel' },
          {
            text: lang === 'fr' ? 'Supprimer' : 'Delete',
            style: 'destructive',
            onPress: async () => {
              if (activeModelRef.current === model.id) {
                clearSessionContext();
                modelAttemptRef.current += 1;
                initializedModelRef.current = null;
                setEngineState('idle');
                activeModelRef.current = null;
                setActiveModelId(null);
                setScreen('models');
                setMessages([]);
                await advisorSession.enqueue(() => LLM.destroy());
              }
              await LLM.deleteModel(getModelFilename(model, Platform.OS));
              refreshDownloadedModels();
              LLM.getFreeDiskSpace().then(setFreeDisk);
            },
          },
        ]
      );
    },
    [advisorSession, clearSessionContext, blockedTerminalModelId, lang, t]
  );

  // ─── Engine Init ─────────────────────────────────────────────

  const handleStartModel = useCallback(
    async (model: ModelInfo, preferCpuText = false) => {
      if (!advisorSession.matchesServer(server)) return;
      const session = clearSessionContext();
      const modelAttempt = ++modelAttemptRef.current;
      initializedModelRef.current = null;
      const analyticsAuthorization = captureAnalyticsAuthorization();
      setEngineState('loading');
      setBackendInfo(null);
      activeModelRef.current = model.id;
      setActiveModelId(model.id);
      setMessages([]);
      try {
        const systemPrompt = buildSystemPrompt(lang, server);
        const serverUrl = SERVERS[server];
        const filename = getModelFilename(model, Platform.OS);
        await advisorSession.enqueue(async () => {
          const result = await LLM.initialize(
            filename,
            systemPrompt,
            serverUrl,
            model.multimodal === true,
            model.toolCalling === true,
            preferCpuText
          );
          // A server switch may supersede the UI session without superseding
          // this model. Its queued reset still needs a successful initialization.
          if (modelAttemptRef.current === modelAttempt) {
            initializedModelRef.current = model.id;
            // Capabilities belong to the model, not the server session. A queued
            // server reset must retain them when initialization finishes late.
            setBackendInfo(
              typeof result === 'object' && result !== null
                ? { backendUsed: result.backendUsed, isMediaTek: result.isMediaTek, hasVision: result.hasVision === true, maxOutputTokens: result.maxOutputTokens }
                : null
            );
          }
          return result;
        });
        if (!advisorSession.isCurrent(session)) return;
        advisorSession.markReady(session);
        setEngineState('ready');
        setMessages([
          {
            role: 'system',
            content: t('advisorReady'),
          },
        ]);
        setScreen('chat');
        trackAIModelStart(model.id, analyticsAuthorization);
      } catch (e: any) {
        if (!advisorSession.isCurrent(session)) return;
        setEngineState('error');
        activeModelRef.current = null;
        setActiveModelId(null);
        Alert.alert(t('error'), e.message);
      }
    },
    [advisorSession, clearSessionContext, lang, server, t]
  );

  // ─── Chat Logic ──────────────────────────────────────────────

  const interruptStream = useCallback(async (
    ticket: { session: number; stream: number }, reason: string, partial: string
  ) => {
    if (!advisorSession.isStreamCurrent(ticket)) return;
    // Invalidate BEFORE cleanup: a rejected send promise can still call onError
    // after event subscriptions are removed. Stale callbacks must stay inert.
    advisorSession.invalidate();
    const cleanup = cleanupRef.current;
    cleanupRef.current = null;
    setStreaming(false);
    setStreamBuffer('');
    streamTextRef.current = '';
    setTokenCount(SYSTEM_PROMPT_TOKENS);
    const notice = lang === 'fr'
      ? 'Réponse interrompue et potentiellement incomplète. Réinitialisation du contexte IA avant de continuer.'
      : lang === 'es'
      ? 'Respuesta interrumpida y posiblemente incompleta. Reiniciando el contexto antes de continuar.'
      : 'Response interrupted and possibly incomplete. Resetting the AI context before continuing.';
    setMessages((prev) => [
      ...prev,
        ...(partial.trim() ? [{ role: 'assistant' as const, source: 'model' as const, content: partial }] : []),
      { role: 'system', content: `${reason}\n${notice}` },
    ]);
    try {
      cleanup?.();
    } catch (error: any) {
      setEngineState('error');
      Alert.alert(t('error'), error?.message || 'Could not request inference cancellation');
      return;
    }
    // A delayed/failed native cancellation or reset must never mark us ready.
    await resetNativeConversation();
  }, [advisorSession, lang, t, SYSTEM_PROMPT_TOKENS, resetNativeConversation]);

  const handleStop = useCallback(async () => {
    if (!renderStream || !advisorSession.isStreamCurrent(renderStream)) return;
    const reason = lang === 'fr' ? 'Arrêt demandé.' : lang === 'es' ? 'Detención solicitada.' : 'Stop requested.';
    await interruptStream(renderStream, reason, streamTextRef.current);
  }, [advisorSession, renderStream, lang, interruptStream]);

  const sendToLLM = useCallback(
    (prompt: string, userDisplay?: string, session = renderSession, request = renderRequest) => {
      if (!advisorSession.matchesServer(server) || !advisorSession.isRequestCurrent(request) || resetInFlightRef.current) return;
      const streamTicket = advisorSession.beginStream(session);
      if (!streamTicket) return;

      // Track tokens for the prompt sent
      const promptTokens = estimateTokens(prompt);

      setMessages((prev) => [
        ...prev,
        { role: 'user', content: userDisplay || prompt },
      ]);

      setStreaming(true);
      setStreamBuffer('');
      streamTextRef.current = '';
      let fullResponse = '';

      trackAIPrompt(activeModelId || 'unknown');

      const cleanup = LLM.sendMessage(prompt, {
        onToken: (token) => {
          if (!advisorSession.isStreamCurrent(streamTicket)) return;
          fullResponse += token;
          streamTextRef.current = fullResponse;
          setStreamBuffer(fullResponse);
        },
        onDone: () => {
          if (!advisorSession.isStreamCurrent(streamTicket)) return;
          advisorSession.endStream(streamTicket);
          const responseTokens = estimateTokens(fullResponse);
          const newTotal = tokenCount + promptTokens + responseTokens;
          setTokenCount(newTotal);

          const msgsToAdd: ChatMessage[] = [
            { role: 'assistant', source: 'model', content: fullResponse },
          ];

          // Auto-reset at 90% context
          if (newTotal >= RESET_THRESHOLD) {
            msgsToAdd.push({
              role: 'system',
              content: lang === 'fr'
                ? `Context plein (${Math.round(newTotal)}/${MAX_TOKENS} tokens). Reset auto pour eviter les hallucinations.`
                : `Context full (${Math.round(newTotal)}/${MAX_TOKENS} tokens). Auto-reset to avoid hallucinations.`,
            });

            // Reset conversation on native side, keep messages in UI for reference
            void resetNativeConversation();
            setTokenCount(SYSTEM_PROMPT_TOKENS);
          }
          // Warning at 75%
          else if (newTotal >= WARNING_THRESHOLD) {
            msgsToAdd.push({
              role: 'system',
              content: lang === 'fr'
                ? `Context: ${Math.round(newTotal)}/${MAX_TOKENS} tokens (~${Math.round((newTotal / MAX_TOKENS) * 100)}%). Reset bientot.`
                : `Context: ${Math.round(newTotal)}/${MAX_TOKENS} tokens (~${Math.round((newTotal / MAX_TOKENS) * 100)}%). Reset soon.`,
            });
          }

          setMessages((prev) => [...prev, ...msgsToAdd]);
          setStreamBuffer('');
          streamTextRef.current = '';
          setStreaming(false);
          cleanupRef.current = null;
        },
        onError: (error) => {
          if (!advisorSession.isStreamCurrent(streamTicket)) return;
          void interruptStream(streamTicket, `Error: ${error}`, fullResponse);
        },
      });
      if (advisorSession.isStreamCurrent(streamTicket)) cleanupRef.current = cleanup;
      else cleanup(); // a synchronous terminal callback must not leave stale cleanup
    },
    [advisorSession, renderSession, renderRequest, tokenCount, lang, server, activeModelId, resetNativeConversation, interruptStream]
  );
  const handleItemSelect = useCallback(
    async (item: AlbionItem, analysisCity: City | null = playerCity) => {
      if (!advisorSession.matchesServer(server) || !advisorSession.isReady(renderSession) || advisorSession.isStreaming()) return;
      const request = advisorSession.beginRequest();
      setSelectedItem(item);
      setMarketCtx(null);
      setShowItemPicker(false);
      setFetchingData(true);

      try {
        const ctx = await fetchMarketContext(item, server);
        if (!advisorSession.isRequestCurrent(request)) return;
        setMarketCtx(ctx);
        if (advisorSession.isReady(request.session)) {
          if (getModelById(activeModelRef.current || '')?.itemAnalysisMode === 'calculator-only') {
            // The tested Qwen contradicts its own loss calculation. Do not
            // stream or rewrite an unvalidated recommendation. Publish the
            // actual calculator/data assessment with explicit provenance.
            const decision = evaluateAdvisorDecision(ctx, server, premiumRef.current);
            const report = formatAdvisorDecision(decision, lang);
            setMessages((prev) => [...prev,
              { role: 'user', content: `${t('advisorAnalyzing')} ${item.n}...` },
              { role: 'assistant', source: 'calculator', content: report },
            ]);
            return;
          }
          const prompt = buildAnalysisPrompt(ctx, lang, premiumRef.current, analysisCity);
          sendToLLM(prompt, `${t('advisorAnalyzing')} ${item.n}...`, request.session, request);
        }
      } catch (e: any) {
        if (advisorSession.isRequestCurrent(request)) Alert.alert(t('error'), e.message);
      } finally {
        if (advisorSession.isRequestCurrent(request)) setFetchingData(false);
      }
    },
    [advisorSession, renderSession, server, lang, t, isPremium, playerCity, sendToLLM]
  );



  const handleSend = useCallback(async () => {
    const session = renderSession;
    const request = renderRequest;
    const text = input.trim();
    if (resetInFlightRef.current) {
      try { await resetInFlightRef.current; } catch { return; }
    }
    if (!text || fetchingData || !advisorSession.matchesServer(server) || !advisorSession.isReady(session) || !advisorSession.isRequestCurrent(request) || advisorSession.isStreaming()) return;

    // Simple fee questions are calculator facts, not an inference task. Keep the
    // provenance visible and do not count this as a generated/native response.
    const feeAnswer = getMarketplaceFeeAnswer(text, lang);
    if (feeAnswer) {
      advisorSession.beginRequest(); // retire callbacks captured before this turn
      setInput((current) => current.trim() === text ? '' : current);
      setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', source: 'calculator', content: feeAnswer }]);
      return;
    }

    // Fast path: "item T4, city" and "city item T4" launch market analysis directly.
    const parsed = parseMarketQuery(text);
    if (parsed.city && onCityDetected) await onCityDetected(parsed.city);
    if (!advisorSession.isReady(session) || !advisorSession.isRequestCurrent(request) || advisorSession.isStreaming()) return;
    setInput((current) => current.trim() === text ? '' : current);
    if (parsed.item) {
      await handleItemSelect(parsed.item, parsed.city || playerCity);
      return;
    }

    const prompt = buildQuestionPrompt(text, marketCtx, lang, parsed.city || playerCity, premiumRef.current);
    sendToLLM(prompt, text, session);
  }, [advisorSession, renderSession, renderRequest, server, input, fetchingData, marketCtx, lang, isPremium, playerCity, onCityDetected, handleItemSelect, sendToLLM]);

  // ─── Image / Vision ──────────────────────────────────────────

  const sendImageToLLM = useCallback(
    (imageUri: string, session = renderSession, request = renderRequest) => {
      if (backendInfo?.hasVision !== true) return;
      if (!advisorSession.matchesServer(server) || !advisorSession.isRequestCurrent(request) || resetInFlightRef.current) return;
      const streamTicket = advisorSession.beginStream(session);
      if (!streamTicket) return;

      const prompt = input.trim() || (lang === 'fr' ? 'Décris cette image.' : 'Describe this image.');
      setInput('');

      // Show image message in chat
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: `[Image] ${prompt}` },
      ]);

      setStreaming(true);
      setStreamBuffer('');
      streamTextRef.current = '';
      let fullResponse = '';

      // Convert content:// or file:// URI to path
      const imagePath = imageUri.replace('file://', '');
      const promptTokens = estimateTokens(prompt) + 500; // ~500 tokens for image

      trackAIImageSent(activeModelId || 'unknown');

      const cleanup = LLM.sendMessageWithImage(prompt, imagePath, {
        onToken: (token) => {
          if (!advisorSession.isStreamCurrent(streamTicket)) return;
          fullResponse += token;
          streamTextRef.current = fullResponse;
          setStreamBuffer(fullResponse);
        },
        onDone: () => {
          if (!advisorSession.isStreamCurrent(streamTicket)) return;
          advisorSession.endStream(streamTicket);
          const responseTokens = estimateTokens(fullResponse);
          const newTotal = tokenCount + promptTokens + responseTokens;
          setTokenCount(newTotal);

          const msgsToAdd: ChatMessage[] = [
            { role: 'assistant', source: 'model', content: fullResponse },
          ];

          if (newTotal >= RESET_THRESHOLD) {
            msgsToAdd.push({
              role: 'system',
              content: lang === 'fr'
                ? `Context plein (${Math.round(newTotal)}/${MAX_TOKENS} tokens). Reset auto.`
                : `Context full (${Math.round(newTotal)}/${MAX_TOKENS} tokens). Auto-reset.`,
            });
            void resetNativeConversation();
            setTokenCount(SYSTEM_PROMPT_TOKENS);
          }

          setMessages((prev) => [...prev, ...msgsToAdd]);
          setStreamBuffer('');
          streamTextRef.current = '';
          setStreaming(false);
          cleanupRef.current = null;
        },
        onError: (error) => {
          if (!advisorSession.isStreamCurrent(streamTicket)) return;
          void interruptStream(streamTicket, `Error: ${error}`, fullResponse);
        },
      });
      if (advisorSession.isStreamCurrent(streamTicket)) cleanupRef.current = cleanup;
      else cleanup();
    },
    [advisorSession, renderSession, renderRequest, backendInfo, input, tokenCount, lang, server, activeModelId, resetNativeConversation, interruptStream]
  );

  const handlePickImage = useCallback(async () => {
    if (backendInfo?.hasVision !== true) return;
    const session = renderSession;
    const request = renderRequest;
    if (!advisorSession.isReady(session) || !advisorSession.isRequestCurrent(request) || advisorSession.isStreaming()) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: false,
    });

    if (!advisorSession.isReady(session) || !advisorSession.isRequestCurrent(request) || result.canceled || !result.assets?.[0]) return;
    sendImageToLLM(result.assets[0].uri, session, request);
  }, [advisorSession, renderSession, renderRequest, backendInfo, sendImageToLLM]);

  const handleTakePhoto = useCallback(async () => {
    if (backendInfo?.hasVision !== true) return;
    const session = renderSession;
    const request = renderRequest;
    if (!advisorSession.isReady(session) || !advisorSession.isRequestCurrent(request) || advisorSession.isStreaming()) return;

    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!advisorSession.isReady(session) || !advisorSession.isRequestCurrent(request)) return;
    if (!perm.granted) {
      Alert.alert(t('error'), lang === 'fr' ? 'Permission caméra refusée' : 'Camera permission denied');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      allowsEditing: false,
    });

    if (!advisorSession.isReady(session) || !advisorSession.isRequestCurrent(request) || result.canceled || !result.assets?.[0]) return;
    sendImageToLLM(result.assets[0].uri, session, request);
  }, [advisorSession, renderSession, renderRequest, backendInfo, sendImageToLLM, lang, t]);

  const handleReset = useCallback(async () => {
    clearSessionContext();
    setMessages([]);
    await resetNativeConversation();
  }, [clearSessionContext, resetNativeConversation]);

  useEffect(() => {
    if (previousServerRef.current === server && !advisorSession.hasServerChange()) return;
    advisorSession.acknowledgeServerChange();
    previousServerRef.current = server;
    clearSessionContext();
    if (activeModelRef.current) void resetNativeConversation();
    setMessages((prev) => [
      ...prev,
      {
        role: 'system',
        content: lang === 'fr'
          ? `Serveur changé: ${server}. Contexte IA mis à jour.`
          : `Server changed: ${server}. AI context updated.`,
      },
    ]);
  }, [advisorSession, renderSession, server, lang, clearSessionContext, resetNativeConversation]);

  const handleBackToModels = useCallback(async () => {
    clearSessionContext();
    modelAttemptRef.current += 1;
    initializedModelRef.current = null;
    setMessages([]);
    setEngineState('idle');
    activeModelRef.current = null;
    setActiveModelId(null);
    setScreen('models');
    setBackendInfo(null);
    await advisorSession.enqueue(() => LLM.destroy());
  }, [advisorSession, clearSessionContext]);

  useEffect(() => {
    advisorSession.mount();
    return () => {
      advisorSession.dispose();
      cleanupRef.current?.();
      // DownloadManager owns the transfer and continues it across navigation.
      // Cancellation is reserved for the explicit Cancel button above.
    };
  }, [advisorSession]);

  // ─── MODEL SELECTION SCREEN ──────────────────────────────────

  if (screen === 'models') {
    const qualityColors: Record<string, string> = { basic: COLORS.warning, good: COLORS.info, excellent: COLORS.profit, overkill: '#C77DFF' };
    const qualityLabels: Record<string, Record<string, string>> = {
      basic: { fr: 'Basique', en: 'Basic', es: 'Básico' },
      good: { fr: 'Bon', en: 'Good', es: 'Bueno' },
      overkill: { fr: 'Flagship', en: 'Flagship', es: 'Flagship' },
      excellent: { fr: 'Excellent', en: 'Excellent', es: 'Excelente' },
    };

    const platformModels = getModelsForPlatform(Platform.OS);
    const webGPUBlocked = isWeb && webGPUSupported === false;

    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.modelsContent}>
        <Text style={styles.title}>{t('advisor')}</Text>
        <Text style={styles.subtitle}>
          {lang === 'fr'
            ? 'Choisis un modèle IA pour analyser le marché'
            : lang === 'es'
            ? 'Elige un modelo IA para analizar el mercado'
            : 'Choose an AI model to analyze the market'}
        </Text>

        {/* WebGPU compatibility banner */}
        {isWeb && webGPUSupported === false && (
          <View style={styles.webGPUBanner}>
            <Text style={styles.webGPUBannerTitle}>
              {lang === 'fr' ? 'WebGPU non disponible' : lang === 'es' ? 'WebGPU no disponible' : 'WebGPU not available'}
            </Text>
            <Text style={styles.webGPUBannerText}>
              {lang === 'fr'
                ? "Ton navigateur ne supporte pas WebGPU. Utilise Chrome 113+ ou Edge 113+ pour l'IA dans le navigateur. Sur mobile, telecharge l'APK Android."
                : lang === 'es'
                ? 'Tu navegador no soporta WebGPU. Usa Chrome 113+ o Edge 113+ para IA en el navegador. En movil, descarga el APK Android.'
                : "Your browser doesn't support WebGPU. Use Chrome 113+ or Edge 113+ for in-browser AI. On mobile, download the Android APK."}
            </Text>
          </View>
        )}

        {isWeb && webGPUSupported === true && (
          <View style={styles.webGPUBannerOk}>
            <Text style={styles.webGPUBannerOkText}>
              {lang === 'fr'
                ? 'WebGPU detecte — IA dans le navigateur disponible'
                : lang === 'es'
                ? 'WebGPU detectado — IA en el navegador disponible'
                : 'WebGPU detected — in-browser AI available'}
            </Text>
          </View>
        )}

        {backendInfo?.isMediaTek && backendInfo.backendUsed === 'cpu' && (
          <View style={[styles.webGPUBanner, { backgroundColor: '#4a3500' }]}>
            <Text style={styles.webGPUBannerTitle}>
              {lang === 'fr' ? 'Chipset MediaTek détecté' : lang === 'es' ? 'Chipset MediaTek detectado' : 'MediaTek chipset detected'}
            </Text>
            <Text style={styles.webGPUBannerText}>
              {lang === 'fr'
                ? "L'accélération GPU n'est pas encore supportée sur MediaTek. L'IA tourne en mode CPU — les petits modèles (Qwen 0.8B) sont recommandés."
                : lang === 'es'
                ? 'La aceleración GPU aún no es compatible con MediaTek. La IA funciona en modo CPU — se recomiendan modelos pequeños (Qwen 0.8B).'
                : 'GPU acceleration is not yet supported on MediaTek. AI runs in CPU mode — smaller models (Qwen 0.8B) are recommended.'}
            </Text>
          </View>
        )}

        {freeDisk > 0 && (
          <Text style={styles.diskInfo}>
            {lang === 'fr' ? 'Espace disponible' : 'Available space'}: {formatBytes(freeDisk)}
          </Text>
        )}

        {/* Engine loading overlay */}
        {engineState === 'loading' && (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingCardText}>{t('advisorLoading')}</Text>
            <Text style={styles.loadingCardHint}>{t('advisorLoadingHint')}</Text>
          </View>
        )}

        {platformModels.map((model) => {
          const modelFile = getModelFilename(model, Platform.OS);
          const isDownloaded = downloadedFilenames.has(modelFile);
          const isDownloading = downloading?.modelId === model.id;
          const isActive = activeModelId === model.id;
          const color = qualityColors[model.quality];

          return (
            <View key={model.id} style={[styles.modelCard, isActive && { borderColor: COLORS.primary }]}>
              {/* Header row */}
              <View style={styles.modelHeader}>
                <Text style={styles.modelName}>{model.name}</Text>
                <View style={[styles.qualityBadge, { backgroundColor: color + '20', borderColor: color }]}>
                  <Text style={[styles.qualityText, { color }]}>
                    {qualityLabels[model.quality][lang] || model.quality}
                  </Text>
                </View>
              </View>

              {/* Description */}
              <Text style={styles.modelDesc}>
                {model.description[lang] || model.description.en}
              </Text>

              {/* Specs row */}
              <View style={styles.specsRow}>
                <View style={styles.specItem}>
                  <Text style={styles.specLabel}>{lang === 'fr' ? 'Taille' : 'Size'}</Text>
                  <Text style={styles.specValue}>{getModelSizeLabel(model, Platform.OS)}</Text>
                </View>
                <View style={styles.specItem}>
                  <Text style={styles.specLabel}>RAM</Text>
                  <Text style={styles.specValue}>{model.ramRequired}</Text>
                </View>
                <View style={styles.specItem}>
                  <Text style={styles.specLabel}>{lang === 'fr' ? 'Licence' : 'License'}</Text>
                  <Text style={styles.specValue}>{Platform.OS === 'web' ? (model.webLicense ?? model.license) : model.license}</Text>
                </View>
                <View style={styles.specItem}>
                  <Text style={styles.specLabel}>Status</Text>
                  <Text style={[styles.specValue, isDownloaded ? { color: COLORS.profit } : { color: COLORS.textMuted }]}>
                    {isDownloaded
                      ? (lang === 'fr' ? 'Installé' : 'Installed')
                      : (lang === 'fr' ? 'Non installé' : 'Not installed')}
                  </Text>
                </View>
              </View>

              {/* Download progress */}
              {isDownloading && downloading && (
                <View style={styles.progressContainer}>
                  <View style={styles.progressBarBg}>
                    <View
                      style={[styles.progressBarFill, { width: `${Math.min(downloading.percent, 100)}%` }]}
                    />
                  </View>
                  <View style={styles.progressInfo}>
                    <Text style={styles.progressText}>
                      {formatBytes(downloading.bytesDownloaded)} / {model.sizeLabel}
                    </Text>
                    <Text style={styles.progressPercent}>
                      {downloading.percent.toFixed(1)}%
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.cancelBtn} onPress={handleCancelDownload}>
                    <Text style={styles.cancelBtnText}>
                      {lang === 'fr' ? 'Annuler' : 'Cancel'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Action buttons */}
              {!isDownloading && (
                <View style={styles.modelActions}>
                  {!isDownloaded ? (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.downloadBtn, webGPUBlocked && { opacity: 0.3 }]}
                      onPress={() => handleDownload(model)}
                      disabled={!!downloading || !!currentDownloadAttemptRef.current || webGPUBlocked}
                    >
                      <Text style={styles.downloadBtnText}>
                        {lang === 'fr' ? 'Télécharger' : lang === 'es' ? 'Descargar' : 'Download'}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.startBtn, webGPUBlocked && { opacity: 0.3 }]}
                        onPress={() => handleStartModel(model)}
                        disabled={engineState === 'loading' || webGPUBlocked}
                      >
                        <Text style={styles.startBtnText}>
                          {lang === 'fr' ? 'Démarrer' : lang === 'es' ? 'Iniciar' : 'Start'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.deleteBtn, blockedTerminalModelId === model.id && { opacity: 0.35 }]}
                        disabled={blockedTerminalModelId === model.id}
                        onPress={() => handleDeleteModel(model)}
                      >
                        <Text style={styles.deleteBtnText}>{'\u{1F5D1}'}</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              )}
              {!isWeb && model.cpuTextOption && isDownloaded && !isDownloading && (
                <View style={{ marginTop: 10 }}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.startBtn, { flex: 0 }]}
                    onPress={() => handleStartModel(model, true)}
                    disabled={engineState === 'loading'}
                  >
                    <Text style={styles.startBtnText}>
                      {lang === 'fr' ? 'Démarrer CPU · texte seul' : lang === 'es' ? 'Iniciar CPU · solo texto' : 'Start CPU · text only'}
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.modelDesc}>
                    {lang === 'fr'
                      ? "Peut réduire la mémoire : même modèle, sans images. Gain non garanti et vitesse variable selon le téléphone. Le bouton Démarrer conserve le mode GPU/vision automatique."
                      : lang === 'es'
                      ? 'Puede reducir memoria: mismo modelo, sin imágenes. Ahorro no garantizado y velocidad variable. Iniciar conserva el modo GPU/visión automático.'
                      : 'May use less memory: same model, no images. Savings are not guaranteed; speed varies by phone. Start keeps automatic GPU/vision mode.'}
                  </Text>
                </View>
              )}
            </View>
          );
        })}

        {/* Info box */}
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>
            {lang === 'fr' ? 'Comment ça marche ?' : 'How does it work?'}
          </Text>
          <Text style={styles.infoText}>
            {isWeb
              ? (lang === 'fr'
                ? "L'IA tourne dans ton navigateur grace a WebLLM + WebGPU. Aucune donnee n'est envoyee a un serveur externe. Le modele est telecharge et cache localement. Chrome 113+ ou Edge 113+ requis."
                : lang === 'es'
                ? 'La IA corre en tu navegador con WebLLM + WebGPU. No se envian datos a servidores externos. El modelo se descarga y almacena localmente. Chrome 113+ o Edge 113+ requerido.'
                : 'The AI runs in your browser using WebLLM + WebGPU. No data is sent to external servers. The model is downloaded and cached locally. Chrome 113+ or Edge 113+ required.')
              : (lang === 'fr'
                ? "L'IA tourne entièrement sur ton téléphone grâce à LiteRT-LM sur CPU ou GPU. Aucune donnée n'est envoyée à un serveur externe. Le modèle analyse les prix du marché Albion en temps réel."
                : 'The AI runs entirely on your phone using LiteRT-LM on CPU or GPU. No data is sent to external servers. The model analyzes Albion market prices in real-time.')}
          </Text>
        </View>
      </ScrollView>
    );
  }

  // ─── CHAT SCREEN ─────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Chat header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={handleBackToModels}>
            <Text style={styles.backBtn}>{'\u{2190}'} {t('advisor')}</Text>
          </TouchableOpacity>
          <View style={styles.headerRight}>
            <View style={styles.modelTag}>
              <Text style={styles.modelTagText}>
                {AVAILABLE_MODELS.find((m) => m.id === activeModelId)?.name || ''}
              </Text>
            </View>
            <Text style={[
              styles.tokenCounter,
              tokenCount >= RESET_THRESHOLD ? { color: COLORS.loss } :
              tokenCount >= WARNING_THRESHOLD ? { color: COLORS.warning } :
              { color: COLORS.textMuted },
            ]}>
              {Math.round(tokenCount)}/{MAX_TOKENS}
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerItemBtn}
            onPress={() => setShowItemPicker(true)}
            disabled={streaming || engineState !== 'ready'}
          >
            <Text style={styles.headerItemBtnText} numberOfLines={1}>
              {selectedItem ? selectedItem.n : t('selectItem')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
            <Text style={styles.resetBtnText}>{'\u{1F5D1}'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!isWeb && backendInfo && (
        <Text style={styles.diskInfo}>
          {backendInfo.backendUsed.toUpperCase()} · {backendInfo.hasVision
            ? (lang === 'fr' ? 'Texte + images' : lang === 'es' ? 'Texto + imágenes' : 'Text + images')
            : (lang === 'fr' ? 'Texte seul · images désactivées' : lang === 'es' ? 'Solo texto · imágenes desactivadas' : 'Text only · images disabled')}
          {backendInfo.maxOutputTokens ? ` · ${lang === 'fr' ? 'Sortie limitée' : lang === 'es' ? 'Salida limitada' : 'Output capped'}: ${backendInfo.maxOutputTokens} tokens (${lang === 'fr' ? 'fin parfois tronquée' : lang === 'es' ? 'puede truncarse' : 'may be truncated'})` : ''}
        </Text>
      )}

      {calculatorOnlyAnalysis && (
        <Text style={styles.analysisSafetyNotice}>
          {lang === 'fr' ? 'Qwen : analyses d’items calculées localement, non générées. ' : lang === 'es' ? 'Qwen: análisis de objetos calculados localmente, no generados. ' : 'Qwen: item analyses are calculated locally, not generated. '}
          {unverifiedAIWarning}
        </Text>
      )}

      {/* Chat messages */}
      <ScrollView ref={scrollRef} style={styles.chatArea} contentContainerStyle={styles.chatContent}>
        {fetchingData && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.loadingText}>{t('advisorFetchingData')}</Text>
          </View>
        )}

        {messages.map((msg, idx) => (
          <View
            key={idx}
            style={[
              styles.messageBubble,
              msg.role === 'user'
                ? styles.userBubble
                : msg.role === 'system'
                ? styles.systemBubble
                : styles.assistantBubble,
            ]}
          >
            {calculatorOnlyAnalysis && msg.role === 'assistant' && msg.source !== 'calculator' && (
              <Text style={styles.analysisSafetyNotice}>{unverifiedAIWarning}</Text>
            )}
            <Text
              style={[
                styles.messageText,
                msg.role === 'user'
                  ? styles.userText
                  : msg.role === 'system'
                  ? styles.systemText
                  : styles.assistantText,
              ]}
              selectable
            >
              {msg.content}
            </Text>
          </View>
        ))}

        {streaming && streamBuffer.length > 0 && (
          <View style={[styles.messageBubble, styles.assistantBubble]}>
            {calculatorOnlyAnalysis && <Text style={styles.analysisSafetyNotice}>{unverifiedAIWarning}</Text>}
            <Text style={[styles.messageText, styles.assistantText]} selectable>
              {streamBuffer}
            </Text>
            <Text style={styles.streamingDot}>{'\u{25CF}'}</Text>
          </View>
        )}

        {streaming && streamBuffer.length === 0 && (
          <View style={[styles.messageBubble, styles.assistantBubble]}>
            <ActivityIndicator size="small" color={COLORS.primary} />
          </View>
        )}
      </ScrollView>

      {/* Input bar */}
      <View style={styles.inputBar}>
        {!isWeb && backendInfo?.hasVision === true && (
          <>
            <TouchableOpacity
              style={styles.imageBtn}
              onPress={handlePickImage}
              disabled={streaming || fetchingData || engineState !== 'ready'}
            >
              <Text style={styles.imageBtnText}>{'\u{1F5BC}'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.imageBtn}
              onPress={handleTakePhoto}
              disabled={streaming || fetchingData || engineState !== 'ready'}
            >
              <Text style={styles.imageBtnText}>{'\u{1F4F7}'}</Text>
            </TouchableOpacity>
          </>
        )}
        <TextInput
          style={styles.textInput}
          value={input}
          onChangeText={setInput}
          placeholder={t('advisorPlaceholder')}
          placeholderTextColor={COLORS.textMuted}
          editable={!streaming}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          multiline
        />
        {streaming ? (
          <TouchableOpacity
            style={[styles.sendBtn, { width: 'auto', paddingHorizontal: SPACING.sm, backgroundColor: COLORS.loss }]}
            onPress={handleStop}
            accessibilityRole="button"
            accessibilityLabel={lang === 'fr' ? 'Arrêter la génération' : lang === 'es' ? 'Detener generación' : 'Stop generation'}
          >
            <Text style={styles.sendBtnText}>{lang === 'fr' ? 'Arrêter' : lang === 'es' ? 'Detener' : 'Stop'}</Text>
          </TouchableOpacity>
        ) : <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || streaming || fetchingData || engineState !== 'ready') && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || streaming || fetchingData || engineState !== 'ready'}
        >
          <Text style={styles.sendBtnText}>{'\u{27A4}'}</Text>
        </TouchableOpacity>}
      </View>

      <ItemPicker
        visible={showItemPicker}
        onClose={() => setShowItemPicker(false)}
        onSelect={handleItemSelect}
        lang={lang}
      />
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  analysisSafetyNotice: {
    color: COLORS.warning,
    fontSize: FONT_SIZE.xs,
    marginBottom: SPACING.sm,
    paddingHorizontal: SPACING.sm,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  // ── Models screen ──
  modelsContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl * 3,
  },
  title: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.title,
    fontWeight: '800',
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.md,
    marginTop: SPACING.xs,
    marginBottom: SPACING.md,
  },
  diskInfo: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginBottom: SPACING.md,
  },
  webGPUBanner: {
    backgroundColor: COLORS.loss + '15',
    borderWidth: 1,
    borderColor: COLORS.loss + '40',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  webGPUBannerTitle: {
    color: COLORS.loss,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  webGPUBannerText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
    lineHeight: 20,
  },
  webGPUBannerOk: {
    backgroundColor: COLORS.profit + '15',
    borderWidth: 1,
    borderColor: COLORS.profit + '40',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  webGPUBannerOkText: {
    color: COLORS.profit,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
  },
  loadingCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    marginBottom: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
  },
  loadingCardText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    marginTop: SPACING.md,
  },
  loadingCardHint: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },

  // ── Model card ──
  modelCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  modelName: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
  },
  qualityBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
  },
  qualityText: {
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
  },
  modelDesc: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  specsRow: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  specItem: {
    flex: 1,
  },
  specLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginBottom: 2,
  },
  specValue: {
    color: COLORS.text,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
  },

  // ── Download progress ──
  progressContainer: {
    marginBottom: SPACING.sm,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: SPACING.xs,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 3,
  },
  progressInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
  },
  progressPercent: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
  },
  cancelBtn: {
    marginTop: SPACING.sm,
    alignSelf: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.loss + '20',
  },
  cancelBtnText: {
    color: COLORS.loss,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
  },

  // ── Action buttons ──
  modelActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  actionBtn: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadBtn: {
    flex: 1,
    backgroundColor: COLORS.info + '20',
    borderWidth: 1,
    borderColor: COLORS.info,
  },
  downloadBtnText: {
    color: COLORS.info,
    fontWeight: '700',
    fontSize: FONT_SIZE.md,
  },
  startBtn: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  startBtnText: {
    color: COLORS.background,
    fontWeight: '700',
    fontSize: FONT_SIZE.md,
  },
  deleteBtn: {
    backgroundColor: COLORS.loss + '15',
    borderWidth: 1,
    borderColor: COLORS.loss + '40',
    paddingHorizontal: SPACING.md,
  },
  deleteBtnText: {
    fontSize: FONT_SIZE.lg,
  },

  // ── Info box ──
  infoBox: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  infoTitle: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  infoText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    lineHeight: 20,
  },

  // ── Chat header ──
  header: {
    padding: SPACING.lg,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  backBtn: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  modelTag: {
    backgroundColor: COLORS.primary + '20',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  modelTagText: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  tokenCounter: {
    fontSize: FONT_SIZE.xs,
    fontFamily: 'monospace',
  },
  headerActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  headerItemBtn: {
    flex: 1,
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  headerItemBtnText: {
    color: COLORS.primary,
    fontWeight: '600',
    fontSize: FONT_SIZE.sm,
  },
  resetBtn: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
  },
  resetBtnText: {
    fontSize: FONT_SIZE.lg,
  },

  // ── Chat ──
  chatArea: {
    flex: 1,
  },
  chatContent: {
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
    gap: SPACING.sm,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  loadingText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
  },
  messageBubble: {
    maxWidth: '85%',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.primary + '20',
    borderWidth: 1,
    borderColor: COLORS.primary + '40',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  systemBubble: {
    alignSelf: 'center',
    backgroundColor: COLORS.info + '15',
    borderWidth: 1,
    borderColor: COLORS.info + '30',
  },
  messageText: {
    fontSize: FONT_SIZE.md,
    lineHeight: 22,
  },
  userText: {
    color: COLORS.primary,
  },
  assistantText: {
    color: COLORS.text,
  },
  systemText: {
    color: COLORS.info,
    textAlign: 'center',
    fontSize: FONT_SIZE.sm,
  },
  streamingDot: {
    color: COLORS.primary,
    fontSize: 8,
    marginTop: SPACING.xs,
    opacity: 0.6,
  },

  // ── Input ──
  inputBar: {
    flexDirection: 'row',
    padding: SPACING.sm,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    alignItems: 'flex-end',
    gap: SPACING.sm,
  },
  textInput: {
    flex: 1,
    backgroundColor: COLORS.background,
    color: COLORS.text,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONT_SIZE.md,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  imageBtn: {
    width: 40,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.7,
  },
  imageBtnText: {
    fontSize: 20,
  },
  sendBtn: {
    backgroundColor: COLORS.primary,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendBtnText: {
    color: COLORS.background,
    fontSize: FONT_SIZE.lg,
  },
});
