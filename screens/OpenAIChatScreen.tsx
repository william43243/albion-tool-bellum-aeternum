import BellumIcon from '../components/BellumIcon';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { Language } from '../lib/i18n';
import { Server, SERVERS } from '../lib/api';
import * as Siwc from '../lib/siwc';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatReadingProvider, CHAT_TEXT_SCALE_KEY, validChatTextScale, nextChatTextScale } from '../components/chat/reading';
import HistoryChartCard from '../components/chat/HistoryChartCard';
import IslandProfitChartCard from '../components/chat/IslandProfitChartCard';
import ChatMarkdown from '../components/chat/ChatMarkdown';
import MapPreviewCard from '../components/chat/MapPreviewCard';
import FlipComparisonCard from '../components/chat/FlipComparisonCard';
import { canSubmitChat, chooseAvailableModel, completedChatHistory, chatErrorPresentation } from '../components/chat/presentation';

type ToolRun = { callId: string; name: string; status: 'running' | 'completed' | 'error'; result?: string };
type Message = { id: number; role: 'user' | 'assistant'; content: string; model?: string; tools: ToolRun[]; state?: 'streaming' | 'completed' | 'error' | 'stopped' };
type Props = { lang: Language; server: Server; active: boolean; onBack: () => void; compact?: boolean; playerCity?: string | null; isPremium?: boolean };
const OPENAI_MODEL_KEY = 'openai_selected_model_v1';

export default function OpenAIChatScreen({ lang, server, active, onBack, compact = false, playerCity, isPremium }: Props) {
  const tr = (fr: string, en: string, es: string) => lang === 'fr' ? fr : lang === 'es' ? es : en;
  const [textScale,setTextScale]=useState(1);
  const [settingsExpanded,setSettingsExpanded]=useState(false);
  const readingTouched=useRef(false);
  const readingWrite=useRef(Promise.resolve());
  useEffect(()=>{
    let mounted=true;
    void AsyncStorage.getItem(CHAT_TEXT_SCALE_KEY).then(value=>{if(mounted&&!readingTouched.current)setTextScale(validChatTextScale(Number(value)));}).catch(()=>{});
    return ()=>{mounted=false;};
  },[]);
  function changeTextScale(value:number){
    readingTouched.current=true;
    setTextScale(value);
    readingWrite.current=readingWrite.current.then(()=>AsyncStorage.setItem(CHAT_TEXT_SCALE_KEY,String(value))).catch(()=>{});
  }
  const [session, setSession] = useState<Siwc.SiwcSession>({ status: 'disconnected' });
  const [models, setModels] = useState<Siwc.SiwcModel[]>([]);
  const [model, setModel] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [modelPicker, setModelPicker] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [sessionVerified, setSessionVerified] = useState(false);
  const [error, setError] = useState('');
  const errorPresentation = chatErrorPresentation(error, lang);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const followBottom = useRef(true);
  const epoch = useRef(0);
  const nextId = useRef(0);
  const running = useRef(false);
  const cancelling = useRef(false);
  const sessionRead = useRef(0);
  const disconnecting = useRef(false);
  const connectPending = useRef(false);
  const authAttempt = useRef(0);
  const alive = useRef(true);
  const account = useRef<string | undefined>(undefined);
  const priorStatus = useRef<Siwc.SiwcSession['status']>('disconnected');
  const serverRef = useRef(server);
  const modelLoad = useRef(0);
  const modelWrite = useRef(Promise.resolve());
  const selected = models.find(entry => entry.id === model);
  const connected = session.status === 'connected';
  const ready = connected && sessionVerified && session.planEnabled !== false && !checkingSession && !connecting && !loadingModels && Boolean(selected);

  const stop = useCallback(() => {
    if (!running.current || cancelling.current) return;
    cancelling.current = true;
    setStopping(true);
    epoch.current++;
    // Keep submission locked until native cancellation has finished.

    setMessages(current => current.map(message => message.state === 'streaming' ? {
      ...message, state: 'stopped', tools: message.tools.map(tool => tool.status === 'running' ? { ...tool, status: 'error', result: 'Interrupted / Interrompu / Interrumpido' } : tool),
    } : message));
    void Siwc.cancel().catch(() => {}).finally(() => {
      cancelling.current = false;
      running.current = false;
      if (alive.current) { setBusy(false); setStopping(false); }
    });
  }, []);

  const loadModels = useCallback(async () => {
    const request = ++modelLoad.current;
    setLoadingModels(true);
    try {
      const [available, savedModel] = await Promise.all([
        Siwc.getModels(),
        AsyncStorage.getItem(OPENAI_MODEL_KEY).catch(() => null),
      ]);
      if (!alive.current || request !== modelLoad.current) return;
      setModels(available);
      setModel(current => {
        const preferred = current || savedModel || '';
        return preferred && !available.some(entry => entry.id === preferred)
          ? '' : chooseAvailableModel(preferred, available);
      });
      setError('');
    } catch (failure) {
      if (alive.current && request === modelLoad.current) {
        setModels([]); setModel(''); setError(failure instanceof Error ? failure.message : 'Model catalog unavailable');
      }
    } finally { if (alive.current && request === modelLoad.current) setLoadingModels(false); }
  }, []);

  const refreshSession = useCallback(async () => {
    if (disconnecting.current) return;
    const read = ++sessionRead.current;
    try {
      const current = await Siwc.getSession();
      if (!alive.current || read !== sessionRead.current) return;
      const changed = account.current !== current.email;
      const newlyConnected = current.status === 'connected' && priorStatus.current !== 'connected';
      if (changed || (priorStatus.current === 'connected' && current.status !== 'connected')) {
        stop(); epoch.current++; setMessages([]); setModels([]); setModel(''); setLoadingModels(false); modelLoad.current++;
      }
      account.current = current.email;
      priorStatus.current = current.status;
      setSession(current);
      setSessionVerified(true);
      if (current.lastError) setError(current.lastError);
      setConnecting(connectPending.current || current.status === 'connecting');
      if (current.status === 'connected' && (changed || newlyConnected)) void loadModels();
    } catch (failure) {
      if (alive.current && read === sessionRead.current) { setSessionVerified(false); setError(failure instanceof Error ? failure.message : 'Session unavailable'); }
    } finally { if (alive.current && read === sessionRead.current) setCheckingSession(false); }
  }, [loadModels, stop]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; epoch.current++; modelLoad.current++; void Siwc.cancel().catch(() => {}); };
  }, []);
  useEffect(() => {
    if (!active) { stop(); return; }
    void refreshSession();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void refreshSession(); });
    return () => listener.remove();
  }, [active, refreshSession, stop]);
  useEffect(() => {
    if (!active || (!connecting && session.status !== 'connecting')) return;
    const timer = setInterval(() => { void refreshSession(); }, 1000);
    return () => clearInterval(timer);
  }, [active, connecting, session.status, refreshSession]);
  useEffect(() => {
    if (serverRef.current === server) return;
    serverRef.current = server;
    stop(); epoch.current++; setMessages([]); setInput(''); setExpanded({});
  }, [server, stop]);

  async function connect() {
    if (connecting || busy || connectPending.current || disconnecting.current) return;
    const attempt = ++authAttempt.current;
    connectPending.current = true;
    setConnecting(true); setError('');
    try {
      await Siwc.connect();
      if (!alive.current || attempt !== authAttempt.current) return;
      connectPending.current = false;
      await refreshSession();
    } catch (failure) {
      if (!alive.current || attempt !== authAttempt.current) return;
      connectPending.current = false;
      setError(failure instanceof Error ? failure.message : 'Connection failed'); setConnecting(false);
    }
  }
  async function disconnect() {
    if (disconnecting.current) return;
    disconnecting.current = true;
    authAttempt.current++;
    connectPending.current = false;
    sessionRead.current++;
    stop(); epoch.current++; modelLoad.current++;
    try {
      await Siwc.disconnect();
      sessionRead.current++;
      setSession({ status: 'disconnected' }); priorStatus.current = 'disconnected'; account.current = undefined;
      setConnecting(false); setMessages([]); setModels([]); setModel(''); setInput(''); setError('');
      setLoadingModels(false);
      Alert.alert(tr('Déconnexion locale', 'Local sign-out', 'Cierre de sesión local'), tr('Pour révoquer aussi l’accès, déconnectez Albion Tool dans les réglages ChatGPT.', 'To also revoke access, disconnect Albion Tool in ChatGPT settings.', 'Para revocar el acceso, desconecta Albion Tool en los ajustes de ChatGPT.'));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Disconnect failed'); }
    finally { disconnecting.current = false; }
  }
  function clearConversation() {
    Alert.alert(tr('Nouvelle conversation ?', 'New conversation?', '¿Nueva conversación?'), tr('Les messages de cette session seront effacés de cet écran.', 'This session’s messages will be cleared from this screen.', 'Los mensajes de esta sesión se borrarán de esta pantalla.'), [
      { text: tr('Annuler', 'Cancel', 'Cancelar'), style: 'cancel' },
      { text: tr('Effacer', 'Clear', 'Borrar'), onPress: () => { stop(); epoch.current++; setMessages([]); setExpanded({}); setError(''); } },
    ]);
  }
  async function send() {
    if (!canSubmitChat(input, ready, model, running.current)) return;
    const prompt = input.trim();
    const request = ++epoch.current;
    const id = ++nextId.current;
    const history = completedChatHistory(messages);
    running.current = true; setBusy(true); setInput(''); setError(''); followBottom.current = true; setShowJumpToBottom(false);
    setMessages(current => [...current, { id: ++nextId.current, role: 'user', content: prompt, tools: [] }, { id, role: 'assistant', content: '', tools: [], model: selected?.displayName ?? model, state: 'streaming' }]);
    let resultText = '';
    let receivedCompletion = false;
    try {
      const result = await Siwc.generate({ model, messages: [...history, { role: 'user', content: prompt }], serverBaseUrl: SERVERS[server], playerCity, isPremium }, event => {
        if (!alive.current || request !== epoch.current) return;
        if (event.type === 'delta') resultText += event.text;
        if (event.type === 'completed') receivedCompletion = true;
        if (event.type === 'error') setError(event.code || event.message);
        setMessages(current => current.map(message => {
          if (message.id !== id) return message;
          if (event.type === 'delta') return { ...message, content: resultText };
          if (event.type === 'tool') {
            const previous = message.tools.find(tool => tool.callId === event.callId);
            const tool: ToolRun = { ...previous, callId: event.callId, name: event.name, status: event.status, ...(event.result === undefined ? {} : { result: event.result }) };
            return { ...message, tools: previous ? message.tools.map(item => item.callId === tool.callId ? tool : item) : [...message.tools, tool] };
          }
          return message;
        }));
      });
      if (!alive.current || request !== epoch.current) return;
      if (!receivedCompletion) throw new Error('STREAM_INCOMPLETE');
      setMessages(current => current.map(message => message.id === id ? {
        ...message, content: result, state: 'completed',
        tools: message.tools.map(tool => tool.status === 'running' ? { ...tool, status: 'error', result: tool.result ?? tr('Résultat de cet outil non confirmé.', 'This tool result was not confirmed.', 'No se confirmó el resultado de esta herramienta.') } : tool),
      } : message));
    } catch (failure) {
      if (!alive.current || request !== epoch.current) return;
      setError(failure instanceof Error ? failure.message : 'Request failed');
      setInput(current => current || prompt);
      setMessages(current => current.map(message => message.id === id ? { ...message, state: 'error', tools: message.tools.map(tool => tool.status === 'running' ? { ...tool, status: 'error' } : tool) } : message));
      void refreshSession();
    } finally {
      if (alive.current && request === epoch.current) { running.current = false; setBusy(false); }
    }
  }

  const status = checkingSession ? tr('Vérification…', 'Checking…', 'Verificando…')
    : connected && !sessionVerified ? tr('Connexion à vérifier', 'Connection needs checking', 'Verifica la conexión')
    : connected ? tr('Connecté', 'Connected', 'Conectado')
    : connecting ? tr('Connexion dans le navigateur…', 'Connecting in browser…', 'Conectando en navegador…')
    : session.status === 'expired' ? tr('Session expirée', 'Session expired', 'Sesión caducada')
    : tr('Non connecté', 'Not connected', 'Sin conexión');
  const toolLabel = (name: string) => ({
    search_item: tr('Recherche d’objet', 'Item search', 'Búsqueda de objeto'),
    get_prices: tr('Prix du marché', 'Market prices', 'Precios de mercado'),
    get_history: tr('Historique des prix', 'Price history', 'Historial de precios'),
    get_time: tr('Date et heure', 'Date and time', 'Fecha y hora'),
    search_zones: tr('Recherche de zones', 'Zone search', 'Búsqueda de zonas'),
    plan_gathering: tr('Plan de récolte', 'Gathering plan', 'Plan de recolección'),
    get_zone_resources: tr('Ressources de zone', 'Zone resources', 'Recursos de zona'),
    compare_flip_routes: tr('Comparaison et trajets', 'Comparison and routes', 'Comparación y rutas'),
    compare_island_crops: tr('Comparaison des cultures', 'Crop comparison', 'Comparación de cultivos'),
    create_price_alert: tr('Alerte de prix', 'Price alert', 'Alerta de precio'),
  } as Record<string, string>)[name] ?? tr('Outil Albion', 'Albion tool', 'Herramienta Albion');

  return <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={styles.header}>
      <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel={tr('Retour aux sections', 'Back to sections', 'Volver a las secciones')} onPress={onBack}><BellumIcon name="back" size={22} color={COLORS.text} /></TouchableOpacity>
      <TouchableOpacity style={styles.grow} accessibilityRole="button" accessibilityLabel={tr('Choisir le modèle', 'Choose model', 'Elegir modelo')} disabled={!connected || busy || loadingModels} onPress={() => setModelPicker(true)}><Text numberOfLines={1} style={styles.title}>{selected?.displayName ?? 'Albion · OpenAI'}{connected ? ' ▾' : ''}</Text><Text numberOfLines={1} style={styles.muted} accessibilityLiveRegion="polite">{status} · {server.toUpperCase()}</Text></TouchableOpacity>
      {compact && <TouchableOpacity style={styles.smallButton} accessibilityRole="button" accessibilityLabel={tr('Masquer le clavier', 'Hide keyboard', 'Ocultar teclado')} onPress={Keyboard.dismiss}><Text style={styles.link}>{tr('Fermer', 'Done', 'Listo')}</Text></TouchableOpacity>}
      {!compact && messages.length > 0 && <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel={tr('Nouvelle conversation', 'New conversation', 'Nueva conversación')} onPress={clearConversation}><BellumIcon name="plus" size={22} color={COLORS.text} /></TouchableOpacity>}
      {!compact && !connected && (connected || connecting || session.status === 'expired' || !!error) && <TouchableOpacity style={styles.smallButton} accessibilityRole="button" onPress={() => void disconnect()}><Text style={styles.link}>{connected || connecting ? tr('Déconnecter', 'Disconnect', 'Desconectar') : tr('Déconnexion locale', 'Local sign-out', 'Cerrar sesión local')}</Text></TouchableOpacity>}
      {connected && !compact && <TouchableOpacity style={styles.iconButton} accessibilityRole="button" accessibilityLabel={tr('Options du chat', 'Chat options', 'Opciones del chat')} onPress={()=>setSettingsExpanded(true)}><BellumIcon name="more" size={22} color={COLORS.text} /></TouchableOpacity>}
    </View>
    {!connected ? <ScrollView contentContainerStyle={styles.welcome} keyboardShouldPersistTaps="handled">
      <View style={styles.mark}><Text style={styles.markText}>A</Text></View>
      <Text style={styles.hero}>{tr('Votre agent\npour Albion.', 'Your agent\nfor Albion.', 'Tu agente\npara Albion.')}</Text>
      <Text style={styles.body}>{tr('Explorez les prix, les historiques et les itinéraires avec votre compte ChatGPT. Les modèles locaux restent accessibles dans « Sur cet appareil ».', 'Explore prices, history and routes with your ChatGPT account. Local models are available under “On this device”.', 'Explora precios, historiales y rutas con tu cuenta de ChatGPT. Los modelos locales están disponibles en «En este dispositivo».')}</Text>
      <View style={styles.notice}><Text style={styles.body}>{tr('En envoyant un message ici, vous transmettez à OpenAI cette conversation et les résultats des outils demandés (prix, historique, routes). Aucun historique local n’est importé. Ne partagez pas de secrets.', 'Sending a message here shares this conversation and requested tool results (prices, history, routes) with OpenAI. Local chat history is never imported. Do not share secrets.', 'Al enviar un mensaje aquí compartes con OpenAI esta conversación y los resultados solicitados (precios, historial, rutas). No se importa el historial local. No compartas secretos.')}</Text></View>
      <TouchableOpacity style={[styles.primaryButton, (connecting || checkingSession) && styles.disabled]} disabled={connecting || checkingSession} accessibilityRole="button" onPress={() => void connect()}>{connecting ? <ActivityIndicator color={COLORS.background} /> : <Text style={styles.primaryText}>{tr('Se connecter avec ChatGPT', 'Sign in with ChatGPT', 'Iniciar sesión con ChatGPT')}</Text>}</TouchableOpacity>
      {connecting && <Text style={styles.muted}>{tr('Terminez ou annulez dans le navigateur, puis revenez ici. « Déconnecter » annule la connexion.', 'Finish or cancel in the browser, then return here. “Disconnect” cancels sign-in.', 'Completa o cancela en el navegador y vuelve aquí. «Desconectar» cancela el inicio.')}</Text>}
    </ScrollView> : <>
      {session.planEnabled === false && <Text style={[styles.note, styles.errorText]}>{tr('L’utilisation de votre forfait ChatGPT n’est pas autorisée pour cette connexion. Reconnectez-vous pour vérifier les autorisations, ou utilisez le moteur local.', 'Use of your ChatGPT plan is not authorized for this connection. Sign in again to check permissions, or use the local engine.', 'El uso de tu plan ChatGPT no está autorizado para esta conexión. Inicia sesión de nuevo para revisar los permisos o usa el motor local.')}</Text>}
      <ChatReadingProvider value={textScale}>
      <ScrollView onLayout={() => { if (followBottom.current) scroll.current?.scrollToEnd({ animated: false }); }} ref={scroll} style={styles.conversation} contentContainerStyle={styles.conversationContent} keyboardShouldPersistTaps="handled" onScroll={({ nativeEvent }) => { const following = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y < 100; followBottom.current = following; setShowJumpToBottom(!following); }} scrollEventThrottle={100} onContentSizeChange={() => { if (followBottom.current) scroll.current?.scrollToEnd({ animated: false }); }}>
        {messages.length === 0 && <View style={styles.empty}><Text style={styles.hero}>{tr('Que voulez-vous explorer ?', 'What would you like to explore?', '¿Qué quieres explorar?')}</Text><Text style={styles.body}>{tr('Posez une question sur Albion. Les outils exécutés et leurs résultats apparaîtront dans la conversation.', 'Ask about Albion. Executed tools and their results will appear in the conversation.', 'Pregunta sobre Albion. Las herramientas ejecutadas y sus resultados aparecerán en la conversación.')}</Text><Text style={styles.muted}>{tr('Messages conservés uniquement pendant cette session.', 'Messages kept only during this session.', 'Mensajes conservados solo durante esta sesión.')}</Text></View>}
        {messages.map(message => <View key={message.id} style={[styles.message, message.role === 'user' ? styles.userMessage : styles.assistantMessage]}>
          <Text style={styles.byline}>{message.role === 'user' ? tr('Vous', 'You', 'Tú') : message.model}</Text>
          {message.tools.map(tool => <View key={tool.callId} style={styles.toolCard}>
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: !!expanded[tool.callId] }} style={styles.toolHeader} onPress={() => setExpanded(current => ({ ...current, [tool.callId]: !current[tool.callId] }))}>
              {tool.status === 'running' && <ActivityIndicator size="small" color={COLORS.primary} />}
              <Text style={[styles.toolLabel,{fontSize:14*textScale,lineHeight:21*textScale}, tool.status === 'error' && styles.errorText]}>{tool.status === 'completed' ? '✓ ' : tool.status === 'error' ? '! ' : ''}{toolLabel(tool.name)} · {tool.status === 'running' ? tr('en cours', 'running', 'en curso') : tool.status === 'completed' ? tr('terminé', 'completed', 'completado') : tr('erreur / interrompu', 'error / interrupted', 'error / interrumpido')} {expanded[tool.callId] ? '▴' : '▾'}</Text>
            </TouchableOpacity>
            {tool.name==='compare_flip_routes'&&tool.status==='running'&&<View style={styles.analysisProgress}><ActivityIndicator size="small" color={COLORS.primary}/><Text style={styles.analysisProgressText}>{tr('Analyse des prix, frais et trajets en cours…','Analyzing prices, fees and routes…','Analizando precios, comisiones y rutas…')}</Text></View>}
            {tool.name==='compare_island_crops'&&tool.status==='running'&&<View style={styles.analysisProgress}><ActivityIndicator size="small" color={COLORS.primary}/><Text style={styles.analysisProgressText}>{tr('Comparaison des cultures et de leur historique…','Comparing crops and their price history…','Comparando cultivos y su historial…')}</Text></View>}
            {tool.name==='compare_island_crops'&&tool.status==='completed'&&<IslandProfitChartCard name={tool.name} result={tool.result} lang={lang}/>}
            {expanded[tool.callId] && <>{tool.status === 'completed' && <><HistoryChartCard name={tool.name} result={tool.result}/><MapPreviewCard name={tool.name} result={tool.result}/><FlipComparisonCard name={tool.name} result={tool.result}/></>}<Text style={styles.toolName}>{tool.name}</Text><Text selectable style={[styles.toolResult,{fontSize:12*textScale,lineHeight:18*textScale}]}>{tool.result ?? tr('Aucun résultat reçu.', 'No result received.', 'No se recibió ningún resultado.')}</Text></>}
          </View>)}
          {!!message.content && <ChatMarkdown content={message.content} />}
          {message.state === 'streaming' && <View style={styles.thinking}><ActivityIndicator size="small" color={COLORS.primary} /><Text style={styles.muted}>{tr('Réponse en cours…', 'Responding…', 'Respondiendo…')}</Text></View>}
          {(message.state === 'error' || message.state === 'stopped') && <Text style={styles.errorText}>{tr('Réponse incomplète', 'Incomplete response', 'Respuesta incompleta')}</Text>}
        </View>)}
      </ScrollView>
      </ChatReadingProvider>
      {showJumpToBottom && messages.length > 0 && <TouchableOpacity accessibilityRole="button" accessibilityLabel={tr('Aller aux derniers messages', 'Go to latest messages', 'Ir a los últimos mensajes')} style={styles.jumpButton} onPress={() => { followBottom.current = true; setShowJumpToBottom(false); scroll.current?.scrollToEnd({ animated: true }); }}><BellumIcon name="arrowDown" size={22} color={COLORS.text} /></TouchableOpacity>}
      <View style={[styles.composer, compact && styles.compactComposer]}>
        <TextInput accessibilityLabel={tr('Message pour OpenAI', 'Message to OpenAI', 'Mensaje para OpenAI')} placeholder={tr('Demandez à votre conseiller…', 'Ask your advisor…', 'Pregunta a tu asesor…')} placeholderTextColor={COLORS.textSecondary} style={[styles.input, compact && styles.compactInput]} value={input} onChangeText={setInput} multiline maxLength={12000} editable={!busy} />
        {busy ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={tr('Arrêter la réponse', 'Stop response', 'Detener respuesta')} style={styles.sendButton} disabled={stopping} onPress={stop}>{stopping ? <ActivityIndicator color={COLORS.background} /> : <BellumIcon name="stop" size={22} color={COLORS.background} />}</TouchableOpacity> : <TouchableOpacity accessibilityRole="button" accessibilityLabel={tr('Envoyer à OpenAI', 'Send to OpenAI', 'Enviar a OpenAI')} accessibilityState={{ disabled: !canSubmitChat(input, ready, model, busy) }} disabled={!canSubmitChat(input, ready, model, busy)} style={[styles.sendButton, !canSubmitChat(input, ready, model, busy) && styles.disabled]} onPress={() => void send()}><BellumIcon name="send" size={22} color={COLORS.background} /></TouchableOpacity>}
      </View>
      {stopping && <Text style={styles.note}>{tr('Arrêt en cours, attente de la fin de l’outil…', 'Stopping, waiting for the tool to finish…', 'Deteniendo, esperando a que termine la herramienta…')}</Text>}
      <Text style={[styles.footer, compact && styles.hidden]}>{tr('Vérifiez les réponses et les données.', 'Check answers and data.', 'Comprueba las respuestas y los datos.')}</Text>
    </>}
    {!!error && <View style={styles.errorBox} accessibilityLiveRegion="polite"><Text style={styles.errorText}>{errorPresentation.message}</Text><Text selectable style={styles.errorText}>{error}</Text><TouchableOpacity accessibilityRole="button" style={styles.smallButton} onPress={() => { setError(''); if (errorPresentation.checkSession) void refreshSession(); }}><Text style={styles.link}>{errorPresentation.actionLabel}</Text></TouchableOpacity></View>}
    <Modal visible={settingsExpanded} transparent animationType="fade" onRequestClose={() => setSettingsExpanded(false)}>
      <View style={styles.modalBackdrop}><View style={styles.modalCard} accessibilityViewIsModal>
        <Text style={styles.title}>{tr('Options du chat', 'Chat options', 'Opciones del chat')}</Text>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text style={styles.settingsLabel}>{tr('Taille du texte', 'Text size', 'Tamaño del texto')}</Text>
          <View style={styles.scaleRow}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={tr('Réduire le texte','Reduce text size','Reducir texto')} disabled={textScale<=0.75} style={[styles.scaleButton,textScale<=0.75&&styles.disabled]} onPress={()=>changeTextScale(nextChatTextScale(textScale,-1))}><Text style={styles.link}>A−</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={tr('Rétablir le texte à 100 %','Reset text size to 100%','Restablecer texto al 100%')} style={styles.scaleButton} onPress={()=>changeTextScale(1)}><Text style={styles.link}>{Math.round(textScale*100)} %</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={tr('Agrandir le texte','Increase text size','Ampliar texto')} disabled={textScale>=1.3} style={[styles.scaleButton,textScale>=1.3&&styles.disabled]} onPress={()=>changeTextScale(nextChatTextScale(textScale,1))}><Text style={styles.link}>A+</Text></TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.settingsAction} accessibilityRole="button" disabled={busy || loadingModels} onPress={() => { setSettingsExpanded(false); setModelPicker(true); }}><Text style={styles.modelText}>{tr('Choisir le modèle', 'Choose model', 'Elegir modelo')}</Text><Text style={styles.muted}>{selected?.displayName ?? tr('Aucun modèle disponible', 'No model available', 'No hay modelos disponibles')}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.settingsAction} accessibilityRole="button" disabled={busy || loadingModels} onPress={() => void loadModels()}><Text style={styles.modelText}>{tr('Actualiser les modèles', 'Refresh models', 'Actualizar modelos')}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.settingsAction} accessibilityRole="button" onPress={() => { setSettingsExpanded(false); void disconnect(); }}><Text style={styles.modelText}>{tr('Déconnecter', 'Disconnect', 'Desconectar')}</Text></TouchableOpacity>
        </ScrollView>
        <TouchableOpacity accessibilityRole="button" style={styles.smallButton} onPress={() => setSettingsExpanded(false)}><Text style={styles.link}>{tr('Fermer', 'Close', 'Cerrar')}</Text></TouchableOpacity>
      </View></View>
    </Modal>
    <Modal visible={modelPicker} transparent animationType="fade" onRequestClose={() => setModelPicker(false)}>
      <View style={styles.modalBackdrop}><View style={styles.modalCard} accessibilityViewIsModal>
        <Text style={styles.title}>{tr('Modèles de votre compte', 'Your account’s models', 'Modelos de tu cuenta')}</Text>
        <ScrollView>{models.length === 0 && <Text style={styles.body}>{tr('Le catalogue n’a renvoyé aucun modèle disponible.', 'The catalog returned no available models.', 'El catálogo no devolvió modelos disponibles.')}</Text>}{models.map(entry => <TouchableOpacity key={entry.id} style={[styles.modelOption, entry.id === model && styles.modelOptionSelected]} accessibilityRole="radio" accessibilityState={{ checked: entry.id === model }} onPress={() => { setModel(entry.id); modelWrite.current = modelWrite.current.then(() => AsyncStorage.setItem(OPENAI_MODEL_KEY, entry.id)).catch(() => {}); setModelPicker(false); }}><Text style={styles.modelText}>{entry.displayName}{entry.id === model ? ' ✓' : ''}</Text><Text style={styles.muted}>{entry.id}</Text></TouchableOpacity>)}</ScrollView>
        <TouchableOpacity accessibilityRole="button" style={styles.smallButton} onPress={() => setModelPicker(false)}><Text style={styles.link}>{tr('Fermer', 'Close', 'Cerrar')}</Text></TouchableOpacity>
      </View></View>
    </Modal>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  hidden: { display: 'none' }, compactComposer: { marginBottom: 8, flexShrink: 0 }, compactInput: { maxHeight: 84 },
  root: { flex: 1, minHeight: 0, backgroundColor: COLORS.background }, grow: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.backgroundElevated },
  title: { color: COLORS.text, fontWeight: '700', fontSize: 18 }, muted: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 18 },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' }, action: { fontSize: 28, color: COLORS.text }, backIcon: { fontSize: 32, color: COLORS.text, lineHeight: 38 }, optionsIcon: { fontSize: 28, color: COLORS.text, lineHeight: 34 },
  smallButton: { minWidth: 48, minHeight: 48, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' }, link: { color: COLORS.primaryLight, fontSize: 13, fontWeight: '600' },
  welcome: { padding: 24, gap: 20, flexGrow: 1, justifyContent: 'center' }, mark: { width: 56, height: 56, borderRadius: 18, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' }, markText: { color: COLORS.primaryLight, fontWeight: '800', fontSize: 28 },
  hero: { color: COLORS.text, fontSize: 26, lineHeight: 34, fontWeight: '700' }, body: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 22 }, notice: { backgroundColor: COLORS.surface, padding: 16, borderRadius: 4, borderWidth: 1, borderColor: COLORS.border },
  primaryButton: { minHeight: 48, backgroundColor: COLORS.primary, borderRadius: 5, alignItems: 'center', justifyContent: 'center', padding: 12 }, primaryText: { color: COLORS.background, fontWeight: '800', fontSize: 16 }, disabled: { opacity: 0.4 },
  modelText: { color: COLORS.text, fontWeight: '600', fontSize: 15 }, note: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 18, paddingHorizontal: 18, paddingVertical: 6 },
  settingsLabel: { color: COLORS.text, fontWeight: '600', fontSize: 15, marginBottom: 8 }, scaleRow: { flexDirection: 'row', gap: 8, marginBottom: 14 }, scaleButton: { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: COLORS.surfaceLight, alignItems: 'center', justifyContent: 'center' }, settingsAction: { minHeight: 52, justifyContent: 'center', paddingVertical: 10, borderTopWidth: 1, borderColor: COLORS.border, gap: 4 },
  conversation: { flex: 1, minHeight: 0 }, conversationContent: { paddingHorizontal: 18, paddingVertical: 20, gap: 24, flexGrow: 1 }, empty: { flex: 1, justifyContent: 'center', gap: 16, paddingVertical: 24 },
  message: { maxWidth: '100%', gap: 8 }, userMessage: { alignSelf: 'flex-end', backgroundColor: COLORS.surfaceLight, borderRadius: 6, padding: 14, maxWidth: '90%' }, assistantMessage: { alignSelf: 'stretch', paddingVertical: 4 }, byline: { color: COLORS.textSecondary, fontWeight: '600', fontSize: 12, lineHeight: 18 },
  analysisProgress: { flexDirection:'row', alignItems:'center', gap:10, paddingHorizontal:12, paddingBottom:12 }, analysisProgressText: { color:COLORS.textSecondary, flex:1, fontSize:12, lineHeight:18 },
  toolCard: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, overflow: 'hidden' }, toolHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 }, toolLabel: { flex: 1, color: COLORS.primaryLight, fontSize: 14, lineHeight: 21 }, toolName: { color: COLORS.textSecondary, paddingHorizontal: 12, fontSize: 12 }, toolResult: { padding: 12, color: COLORS.text, fontSize: 12, lineHeight: 18, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }, thinking: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  jumpButton: { alignSelf: 'center', minWidth: 48, minHeight: 48, borderRadius: 5, marginBottom: 4, backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.borderStrong, alignItems: 'center', justifyContent: 'center' }, jumpText: { color: COLORS.text, fontSize: 22 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginHorizontal: 12, marginTop: 4, padding: 8, borderRadius: 5, borderWidth: 1, borderColor: COLORS.borderStrong, backgroundColor: COLORS.surface }, input: { flex: 1, color: COLORS.text, minHeight: 48, maxHeight: 140, fontSize: 16, paddingHorizontal: 10, paddingVertical: 10 }, sendButton: { minWidth: 48, height: 48, borderRadius: 5, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' }, footer: { color: COLORS.textSecondary, fontSize: 11, lineHeight: 16, textAlign: 'center', paddingHorizontal: 20, paddingVertical: 6 },
  errorBox: { backgroundColor: COLORS.lossBg, borderTopWidth: 1, borderColor: COLORS.loss, paddingHorizontal: 16, paddingVertical: 8, maxHeight: 160 }, errorText: { color: COLORS.lossSoft, fontSize: 13, lineHeight: 20 },
  modalBackdrop: { flex: 1, backgroundColor: COLORS.overlay, justifyContent: 'center', padding: 24 }, modalCard: { maxHeight: '80%', backgroundColor: COLORS.backgroundElevated, borderRadius: 20, padding: 20, gap: 16, borderWidth: 1, borderColor: COLORS.borderStrong }, modelOption: { padding: 14, minHeight: 56, borderRadius: 12, gap: 4, marginBottom: 8 }, modelOptionSelected: { backgroundColor: COLORS.primarySoft },
});
