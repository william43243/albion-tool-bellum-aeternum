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
import { Server } from '../lib/api';
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
import * as LiteRT from '../lib/litert';
import * as ImagePicker from 'expo-image-picker';
import { AVAILABLE_MODELS, ModelInfo, formatBytes } from '../lib/models';
import { trackAIPrompt, trackAIModelDownload, trackAIModelStart, trackAIImageSent } from '../lib/analytics';

interface Props {
  t: (key: any) => any;
  lang: Language;
  server: Server;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

type Screen = 'models' | 'chat';
type EngineState = 'idle' | 'loading' | 'ready' | 'error';

interface DownloadState {
  modelId: string;
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
  isResuming: boolean;
}

export default function AdvisorScreen({ t, lang, server }: Props) {
  const [screen, setScreen] = useState<Screen>('models');
  const [engineState, setEngineState] = useState<EngineState>('idle');
  const [downloadedFilenames, setDownloadedFilenames] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState<DownloadState | null>(null);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [freeDisk, setFreeDisk] = useState<number>(-1);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [selectedItem, setSelectedItem] = useState<AlbionItem | null>(null);
  const [marketCtx, setMarketCtx] = useState<MarketContext | null>(null);
  const [fetchingData, setFetchingData] = useState(false);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [tokenCount, setTokenCount] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const cancelDownloadRef = useRef<(() => void) | null>(null);

  // ~4 chars per token is a rough estimate for English/French
  const MAX_TOKENS = 4096;
  const SYSTEM_PROMPT_TOKENS = 250; // approx
  const WARNING_THRESHOLD = MAX_TOKENS * 0.75; // warn at 75%
  const RESET_THRESHOLD = MAX_TOKENS * 0.90;   // auto-reset at 90%

  const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

  // Load downloaded models on mount + refresh when app comes back to foreground
  useEffect(() => {
    refreshDownloadedModels();
    LiteRT.getFreeDiskSpace().then(setFreeDisk);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshDownloadedModels();
        LiteRT.getFreeDiskSpace().then(setFreeDisk);
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages, streamBuffer]);

  const refreshDownloadedModels = async () => {
    const models = await LiteRT.getDownloadedModels();
    const filenames = new Set(models.map((m) => m.filename));
    setDownloadedFilenames(filenames);
  };

  // ─── Model Download ──────────────────────────────────────────

  const handleDownload = useCallback(
    (model: ModelInfo) => {
      if (downloading) return;

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

      setDownloading({ modelId: model.id, percent: 0, bytesDownloaded: 0, totalBytes: model.sizeBytes, isResuming: false });

      try {
        const { promise, cancel } = LiteRT.downloadModel(
          model.id,
          model.downloadUrl,
          model.filename,
          {
            onProgress: (bytesDownloaded, totalBytes, percent, status) => {
              setDownloading((prev) =>
                prev
                  ? {
                      ...prev,
                      bytesDownloaded,
                      totalBytes,
                      percent,
                      isResuming: status === 'resuming' || prev.isResuming,
                    }
                  : null
              );
            },
          }
        );

        cancelDownloadRef.current = cancel;

        promise
          .then(() => {
            setDownloading(null);
            cancelDownloadRef.current = null;
            refreshDownloadedModels();
            LiteRT.getFreeDiskSpace().then(setFreeDisk);
            trackAIModelDownload(model.id);
          })
          .catch((err: any) => {
            setDownloading(null);
            cancelDownloadRef.current = null;
            const msg = err?.message || String(err) || 'Unknown error';
            if (!msg.includes('cancelled')) {
              Alert.alert(t('error'), msg);
            }
          });
      } catch (err: any) {
        setDownloading(null);
        Alert.alert(t('error'), err?.message || String(err));
      }
    },
    [downloading, freeDisk, lang, t]
  );

  const handleCancelDownload = useCallback(() => {
    cancelDownloadRef.current?.();
    setDownloading(null);
  }, []);

  const handleDeleteModel = useCallback(
    async (model: ModelInfo) => {
      Alert.alert(
        lang === 'fr' ? 'Supprimer le modèle ?' : 'Delete model?',
        model.name,
        [
          { text: lang === 'fr' ? 'Annuler' : 'Cancel', style: 'cancel' },
          {
            text: lang === 'fr' ? 'Supprimer' : 'Delete',
            style: 'destructive',
            onPress: async () => {
              if (activeModelId === model.id) {
                await LiteRT.destroy();
                setEngineState('idle');
                setActiveModelId(null);
                setScreen('models');
              }
              await LiteRT.deleteModel(model.filename);
              refreshDownloadedModels();
              LiteRT.getFreeDiskSpace().then(setFreeDisk);
            },
          },
        ]
      );
    },
    [activeModelId, lang]
  );

  // ─── Engine Init ─────────────────────────────────────────────

  const handleStartModel = useCallback(
    async (model: ModelInfo) => {
      setEngineState('loading');
      setActiveModelId(model.id);
      try {
        const systemPrompt = buildSystemPrompt(lang, server);
        const serverUrl = SERVERS[server];
        await LiteRT.initialize(model.filename, systemPrompt, serverUrl);
        setEngineState('ready');
        setMessages([
          {
            role: 'system',
            content: t('advisorReady'),
          },
        ]);
        setScreen('chat');
        trackAIModelStart(model.id);
      } catch (e: any) {
        setEngineState('error');
        setActiveModelId(null);
        Alert.alert(t('error'), e.message);
      }
    },
    [lang, t]
  );

  // ─── Chat Logic ──────────────────────────────────────────────

  const handleItemSelect = useCallback(
    async (item: AlbionItem) => {
      setSelectedItem(item);
      setShowItemPicker(false);
      setFetchingData(true);

      try {
        const ctx = await fetchMarketContext(item, server);
        setMarketCtx(ctx);
        if (engineState === 'ready') {
          const prompt = buildAnalysisPrompt(ctx, lang);
          sendToLLM(prompt, `${t('advisorAnalyzing')} ${item.n}...`);
        }
      } catch (e: any) {
        Alert.alert(t('error'), e.message);
      }
      setFetchingData(false);
    },
    [server, engineState, lang, t]
  );

  const sendToLLM = useCallback(
    (prompt: string, userDisplay?: string) => {
      if (streaming) return;

      // Track tokens for the prompt sent
      const promptTokens = estimateTokens(prompt);

      setMessages((prev) => [
        ...prev,
        { role: 'user', content: userDisplay || prompt },
      ]);

      setStreaming(true);
      setStreamBuffer('');
      let fullResponse = '';

      trackAIPrompt(activeModelId || 'unknown');

      cleanupRef.current = LiteRT.sendMessage(prompt, {
        onToken: (token) => {
          fullResponse += token;
          setStreamBuffer(fullResponse);
        },
        onDone: () => {
          const responseTokens = estimateTokens(fullResponse);
          const newTotal = tokenCount + promptTokens + responseTokens;
          setTokenCount(newTotal);

          const msgsToAdd: ChatMessage[] = [
            { role: 'assistant', content: fullResponse },
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
            LiteRT.resetConversation(buildSystemPrompt(lang, server)).catch(() => {});
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
          setStreaming(false);
          cleanupRef.current = null;
        },
        onError: (error) => {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `Error: ${error}` },
          ]);
          setStreamBuffer('');
          setStreaming(false);
          cleanupRef.current = null;
        },
      });
    },
    [streaming, tokenCount, lang]
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || streaming || engineState !== 'ready') return;
    setInput('');
    const prompt = buildQuestionPrompt(text, marketCtx, lang);
    sendToLLM(prompt, text);
  }, [input, streaming, engineState, marketCtx, lang, sendToLLM]);

  // ─── Image / Vision ──────────────────────────────────────────

  const handlePickImage = useCallback(async () => {
    if (streaming || engineState !== 'ready') return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets?.[0]) return;
    sendImageToLLM(result.assets[0].uri);
  }, [streaming, engineState]);

  const handleTakePhoto = useCallback(async () => {
    if (streaming || engineState !== 'ready') return;

    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('error'), lang === 'fr' ? 'Permission caméra refusée' : 'Camera permission denied');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets?.[0]) return;
    sendImageToLLM(result.assets[0].uri);
  }, [streaming, engineState]);

  const sendImageToLLM = useCallback(
    (imageUri: string) => {
      if (streaming) return;

      const prompt = input.trim() || (lang === 'fr' ? 'Décris cette image.' : 'Describe this image.');
      setInput('');

      // Show image message in chat
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: `[Image] ${prompt}` },
      ]);

      setStreaming(true);
      setStreamBuffer('');
      let fullResponse = '';

      // Convert content:// or file:// URI to path
      const imagePath = imageUri.replace('file://', '');
      const promptTokens = estimateTokens(prompt) + 500; // ~500 tokens for image

      trackAIImageSent(activeModelId || 'unknown');

      cleanupRef.current = LiteRT.sendMessageWithImage(prompt, imagePath, {
        onToken: (token) => {
          fullResponse += token;
          setStreamBuffer(fullResponse);
        },
        onDone: () => {
          const responseTokens = estimateTokens(fullResponse);
          const newTotal = tokenCount + promptTokens + responseTokens;
          setTokenCount(newTotal);

          const msgsToAdd: ChatMessage[] = [
            { role: 'assistant', content: fullResponse },
          ];

          if (newTotal >= RESET_THRESHOLD) {
            msgsToAdd.push({
              role: 'system',
              content: lang === 'fr'
                ? `Context plein (${Math.round(newTotal)}/${MAX_TOKENS} tokens). Reset auto.`
                : `Context full (${Math.round(newTotal)}/${MAX_TOKENS} tokens). Auto-reset.`,
            });
            LiteRT.resetConversation(buildSystemPrompt(lang, server)).catch(() => {});
            setTokenCount(SYSTEM_PROMPT_TOKENS);
          }

          setMessages((prev) => [...prev, ...msgsToAdd]);
          setStreamBuffer('');
          setStreaming(false);
          cleanupRef.current = null;
        },
        onError: (error) => {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `Error: ${error}` },
          ]);
          setStreamBuffer('');
          setStreaming(false);
          cleanupRef.current = null;
        },
      });
    },
    [streaming, input, tokenCount, lang]
  );

  const handleReset = useCallback(async () => {
    cleanupRef.current?.();
    setStreaming(false);
    setStreamBuffer('');
    setMessages([]);
    setMarketCtx(null);
    setSelectedItem(null);
    setTokenCount(SYSTEM_PROMPT_TOKENS);
    try {
      await LiteRT.resetConversation(buildSystemPrompt(lang, server));
    } catch {}
  }, [lang]);

  const handleBackToModels = useCallback(async () => {
    cleanupRef.current?.();
    setStreaming(false);
    setStreamBuffer('');
    setMessages([]);
    setMarketCtx(null);
    setSelectedItem(null);
    await LiteRT.destroy();
    setEngineState('idle');
    setActiveModelId(null);
    setScreen('models');
  }, []);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cancelDownloadRef.current?.();
    };
  }, []);

  // ─── MODEL SELECTION SCREEN ──────────────────────────────────

  if (screen === 'models') {
    const qualityColors: Record<string, string> = { basic: COLORS.warning, good: COLORS.info, excellent: COLORS.profit, overkill: '#C77DFF' };
    const qualityLabels: Record<string, Record<string, string>> = {
      basic: { fr: 'Basique', en: 'Basic', es: 'Básico' },
      good: { fr: 'Bon', en: 'Good', es: 'Bueno' },
      overkill: { fr: 'Flagship', en: 'Flagship', es: 'Flagship' },
      excellent: { fr: 'Excellent', en: 'Excellent', es: 'Excelente' },
    };

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

        {AVAILABLE_MODELS.map((model) => {
          const isDownloaded = downloadedFilenames.has(model.filename);
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
                  <Text style={styles.specValue}>{model.sizeLabel}</Text>
                </View>
                <View style={styles.specItem}>
                  <Text style={styles.specLabel}>RAM</Text>
                  <Text style={styles.specValue}>{model.ramRequired}</Text>
                </View>
                <View style={styles.specItem}>
                  <Text style={styles.specLabel}>{lang === 'fr' ? 'Licence' : 'License'}</Text>
                  <Text style={styles.specValue}>{model.license}</Text>
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
                  {downloading.isResuming && (
                    <Text style={styles.resumingText}>
                      {lang === 'fr'
                        ? `Reprise depuis ${formatBytes(downloading.bytesDownloaded)}…`
                        : lang === 'es'
                        ? `Reanudando desde ${formatBytes(downloading.bytesDownloaded)}…`
                        : `Resuming from ${formatBytes(downloading.bytesDownloaded)}…`}
                    </Text>
                  )}
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
                      style={[styles.actionBtn, styles.downloadBtn]}
                      onPress={() => handleDownload(model)}
                      disabled={!!downloading}
                    >
                      <Text style={styles.downloadBtnText}>
                        {lang === 'fr' ? 'Télécharger' : lang === 'es' ? 'Descargar' : 'Download'}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.startBtn]}
                        onPress={() => handleStartModel(model)}
                        disabled={engineState === 'loading'}
                      >
                        <Text style={styles.startBtnText}>
                          {lang === 'fr' ? 'Démarrer' : lang === 'es' ? 'Iniciar' : 'Start'}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.deleteBtn]}
                        onPress={() => handleDeleteModel(model)}
                      >
                        <Text style={styles.deleteBtnText}>{'\u{1F5D1}'}</Text>
                      </TouchableOpacity>
                    </>
                  )}
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
            {lang === 'fr'
              ? "L'IA tourne entièrement sur ton téléphone grâce à LiteRT-LM avec accélération GPU. Aucune donnée n'est envoyée à un serveur externe. Le modèle analyse les prix du marché Albion en temps réel."
              : 'The AI runs entirely on your phone using LiteRT-LM with GPU acceleration. No data is sent to external servers. The model analyzes Albion market prices in real-time.'}
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
        <TouchableOpacity
          style={styles.imageBtn}
          onPress={handlePickImage}
          disabled={streaming}
        >
          <Text style={styles.imageBtnText}>{'\u{1F5BC}'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.imageBtn}
          onPress={handleTakePhoto}
          disabled={streaming}
        >
          <Text style={styles.imageBtnText}>{'\u{1F4F7}'}</Text>
        </TouchableOpacity>
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
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || streaming) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || streaming}
        >
          <Text style={styles.sendBtnText}>{'\u{27A4}'}</Text>
        </TouchableOpacity>
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
  resumingText: {
    color: COLORS.warning,
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
    marginBottom: SPACING.xs,
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
