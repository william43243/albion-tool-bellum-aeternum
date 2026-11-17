import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Alert, Keyboard, Modal, Pressable, ScrollView, View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { useAndroidKeyboardViewport } from './hooks/useAndroidKeyboardViewport';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import { useLanguage } from './hooks/useLanguage';
import { useServer } from './hooks/useServer';
import { usePlayerCity } from './hooks/usePlayerCity';
import CitySelector from './components/CitySelector';
import BellumIcon from './components/BellumIcon';
import AnalyticsConsentPrompt from './components/AnalyticsConsentPrompt';
import { COLORS, SPACING, FONT_SIZE } from './constants/theme';
import {
  AnalyticsConsent,
  getAnalyticsConsent,
  initializeAnalyticsConsent,
  setAnalyticsConsent,
  trackPageView,
  trackToolUse,
} from './lib/analytics';

import MarketplaceScreen from './screens/MarketplaceScreen';
import CraftHubScreen from './screens/CraftHubScreen';
import FlippingScreen from './screens/FlippingScreen';
import HistoryScreen from './screens/HistoryScreen';
import AdvisorHubScreen from './screens/AdvisorHubScreen';
import SettingsScreen from './screens/SettingsScreen';
import WorldMapScreen from './screens/WorldMapScreen';
import PlanHubScreen from './screens/PlanHubScreen';
import type {ProductionScenario} from './lib/productionTypes';

type TabKey = 'marketplace' | 'crafting' | 'flipping' | 'history' | 'advisor' | 'map' | 'plan' | 'settings';

const TABS: TabKey[] = ['advisor', 'marketplace', 'crafting', 'flipping', 'history', 'map', 'plan', 'settings'];
const COMPACT_TABS: TabKey[] = ['advisor', 'marketplace', 'plan', 'map'];
const NARROW_TABS: TabKey[] = ['advisor', 'marketplace', 'map'];

function AppContent() {
  const { lang, switchLanguage, t, loaded } = useLanguage();
  const { server, switchServer, serverLoaded } = useServer();
  const { city, selectCity, cityLoaded } = usePlayerCity();
  const [showCitySelector, setShowCitySelector] = useState(false);
  const [showToolIndex, setShowToolIndex] = useState(false);
  const [mapFullscreen,setMapFullscreen]=useState(false);
  const [plannedRoute,setPlannedRoute]=useState<{sequence:number;zoneIds:string[]}|undefined>();
  const [productionIncoming,setProductionIncoming]=useState<{sequence:number;scenario:ProductionScenario}|undefined>();
  const [activeTab, setActiveTab] = useState<TabKey>('marketplace');
  const [advisorProvider, setAdvisorProvider] = useState<'local' | 'openai'>('openai');
  const openAIChatVisible = activeTab === 'advisor' && advisorProvider === 'openai';
  const keyboardViewport = useAndroidKeyboardViewport(activeTab === 'advisor');
  const [isPremium, setIsPremium] = useState(true);
  const [analyticsConsent, setAnalyticsConsentState] = useState<AnalyticsConsent>('undecided');
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const shellHidden = keyboardViewport.keyboardVisible || openAIChatVisible || (activeTab === 'map' && mapFullscreen);
  const contentWidth = width - insets.left - insets.right;
  const expandedTabs = contentWidth >= 760 * Math.max(1, fontScale);
  const visibleTabs = expandedTabs ? TABS : contentWidth < 290 ? NARROW_TABS : COMPACT_TABS;
  const remainingTabs = TABS.filter(tab => !visibleTabs.includes(tab));
  const languageText = (fr: string, en: string, es: string) => lang === 'fr' ? fr : lang === 'es' ? es : en;
  const labelFor = (tab: TabKey) => tab === 'plan' ? 'Plan' :
    tab === 'map' ? languageText('Carte', 'Map', 'Mapa') :
    tab === 'advisor' ? languageText('Agent IA', 'AI agent', 'Agente IA') :
    tab === 'crafting' ? languageText('Fabrication', 'Crafting', 'Fabricación') : t(tab);
  const compactLabelFor = (tab: TabKey) => tab === 'crafting' ?
    languageText('Craft', 'Craft', 'Crear') : labelFor(tab);
  const moreLabel = languageText('Plus', 'More', 'Más');
  const toolIndexLabel = languageText('Autres outils', 'More tools', 'Más herramientas');
  const dismissLabel = languageText('Fermer', 'Close', 'Cerrar');
  const cityLabel = city || languageText('Choisir ma ville', 'Choose my city', 'Elegir mi ciudad');
  const editCityLabel = languageText('Changer de ville', 'Change city', 'Cambiar de ciudad');

  useEffect(() => {
    let active = true;
    initializeAnalyticsConsent().then((choice) => {
      if (!active) return;
      setAnalyticsConsentState(choice);
      setAnalyticsLoaded(true);
      if (choice === 'accepted') trackPageView('/marketplace');
    });
    return () => { active = false; };
  }, []);

  const changeAnalyticsConsent = async (choice: 'accepted' | 'refused') => {
    const previous = analyticsConsent;
    try {
      await setAnalyticsConsent(choice);
      if (previous !== 'accepted' && choice === 'accepted') trackPageView('/' + activeTab);
    } catch {
      const messages: Record<string, string> = {
        fr: "Impossible d'enregistrer ce choix. L'analytique est désactivée pour cette session; réessayez avant de redémarrer.",
        en: 'Unable to save this choice. Analytics is disabled for this session; retry before restarting.',
        es: 'No se pudo guardar esta opción. Las analíticas están desactivadas durante esta sesión; inténtalo de nuevo antes de reiniciar.',
      };
      Alert.alert('Analytics', messages[lang] || messages.en);
    } finally {
      setAnalyticsConsentState(getAnalyticsConsent());
    }
  };

  const handleTabChange = (tab: TabKey) => {
    Keyboard.dismiss();
    setShowToolIndex(false);
    setMapFullscreen(false);
    setActiveTab(tab);
    trackPageView('/' + tab);
    trackToolUse(tab);
  };

  if (!loaded || !serverLoaded || !cityLoaded || !analyticsLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="dark" />
        <Text style={styles.loadingText}>Bellum Aeternum</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} ref={keyboardViewport.rootRef} onLayout={keyboardViewport.measureRoot} collapsable={false}>
      <View style={[styles.container, { maxHeight: keyboardViewport.maxHeight }]}>
      <StatusBar style="dark" />

      {/* Top safe area spacer */}
      <View style={{ height: insets.top, backgroundColor: COLORS.background }} />

      <View style={[
        styles.masthead,
        keyboardViewport.keyboardVisible && { display: 'none' },
        (openAIChatVisible || (activeTab === 'map' && mapFullscreen)) && { display: 'none' },
        { paddingLeft: SPACING.md + insets.left, paddingRight: SPACING.md + insets.right },
      ]}>
        <View style={styles.mastheadTitle}>
          <Text style={styles.wordmark}>Bellum Aeternum</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={city ? editCityLabel + ' : ' + city : cityLabel}
          onPress={() => setShowCitySelector(true)}
          style={({ pressed }) => [styles.location, pressed && styles.pressed]}
        >
          <BellumIcon name="pin" size={18} color={COLORS.primary} />
          <Text numberOfLines={2} style={styles.locationText}>{cityLabel}</Text>
          <BellumIcon name="chevronDown" size={12} color={COLORS.textSecondary} />
        </Pressable>
      </View>

      {/* All screens stay mounted; hidden via display:'none' to preserve state */}
      <View style={[styles.screenContainer, activeTab !== 'marketplace' && { display: 'none' }]}>
        <MarketplaceScreen t={t} lang={lang} server={server} isPremium={isPremium} onPremiumChange={setIsPremium} />
      </View>
      <View style={[styles.screenContainer, activeTab !== 'crafting' && { display: 'none' }]}>
        <CraftHubScreen t={t} lang={lang} server={server} active={activeTab === 'crafting'} onTransfer={scenario=>{setProductionIncoming(old=>({sequence:(old?.sequence??0)+1,scenario}));handleTabChange('plan');}} />
      </View>
      <View style={[styles.screenContainer, activeTab !== 'flipping' && { display: 'none' }]}>
        <FlippingScreen t={t} lang={lang} isPremium={isPremium} onPremiumChange={setIsPremium} />
      </View>
      <View style={[styles.screenContainer, activeTab !== 'history' && { display: 'none' }]}>
        <HistoryScreen t={t} lang={lang} server={server} />
      </View>
      <View style={[styles.screenContainer, activeTab !== 'advisor' && { display: 'none' }, openAIChatVisible && !keyboardViewport.keyboardVisible && { paddingBottom: insets.bottom }]}>
        <AdvisorHubScreen active={activeTab === 'advisor'} compact={keyboardViewport.keyboardVisible} onProviderChange={setAdvisorProvider} onBackToSections={() => handleTabChange('marketplace')} t={t} lang={lang} server={server} playerCity={city} onCityDetected={selectCity} isPremium={isPremium} />
      </View>
      {activeTab === 'map' && <View style={[styles.screenContainer,mapFullscreen&&{paddingBottom:insets.bottom}]}><WorldMapScreen fullScreen={mapFullscreen} onFullScreenChange={setMapFullscreen} plannedRoute={plannedRoute}/></View>}
      <View style={[styles.screenContainer, activeTab !== 'plan' && { display: 'none' }]}>
        <PlanHubScreen lang={lang} server={server} active={activeTab === 'plan'} incoming={productionIncoming} onShowRoute={zoneIds=>{setPlannedRoute(old=>({sequence:(old?.sequence??0)+1,zoneIds}));handleTabChange('map');}} />
      </View>
      <View style={[styles.screenContainer, activeTab !== 'settings' && { display: 'none' }]}>
        <SettingsScreen
          t={t}
          lang={lang}
          onSwitchLanguage={switchLanguage}
          server={server}
          onSwitchServer={switchServer}
          analyticsConsent={analyticsConsent}
          onAnalyticsConsentChange={changeAnalyticsConsent}
        />
      </View>

      <CitySelector
        lang={lang}
        visible={showCitySelector || city === null}
        city={city}
        required={city === null}
        onSelect={async (nextCity) => {
          await selectCity(nextCity);
          setShowCitySelector(false);
        }}
        onClose={() => setShowCitySelector(false)}
      />

      <AnalyticsConsentPrompt
        visible={analyticsLoaded && analyticsConsent === 'undecided'}
        t={t}
        onChoice={changeAnalyticsConsent}
      />

      {!shellHidden && <View style={[
        styles.tabBar,
        { paddingBottom: Math.max(insets.bottom, 6), paddingLeft: insets.left, paddingRight: insets.right },
      ]}>
        <View accessibilityRole="tablist" style={[styles.tabStrip, { flex: visibleTabs.length }]}>
          {visibleTabs.map(tab => {
            const selected = activeTab === tab;
            return (
              <Pressable
                key={tab}
                accessibilityRole="tab"
                accessibilityLabel={labelFor(tab)}
                accessibilityState={{ selected }}
                onPress={() => handleTabChange(tab)}
                style={({ pressed }) => [styles.tabItem, selected && styles.tabSelected, pressed && styles.pressed]}
              >
                <BellumIcon name={tab} size={22} color={selected ? COLORS.primary : COLORS.textSecondary} selected={selected} />
                <Text style={[styles.tabLabel, selected && styles.selectedLabel]}>{expandedTabs ? labelFor(tab) : compactLabelFor(tab)}</Text>
              </Pressable>
            );
          })}
        </View>
        {!expandedTabs && <Pressable
          accessibilityRole="button"
          accessibilityLabel={remainingTabs.includes(activeTab) ? toolIndexLabel + ' : ' + labelFor(activeTab) : toolIndexLabel}
          accessibilityState={{ expanded: showToolIndex }}
          onPress={() => setShowToolIndex(true)}
          style={({ pressed }) => [
            styles.tabItem, styles.moreTab, remainingTabs.includes(activeTab) && styles.tabSelected, pressed && styles.pressed,
          ]}
        >
          <BellumIcon name="more" size={22} color={remainingTabs.includes(activeTab) ? COLORS.primary : COLORS.textSecondary} />
          <Text style={[styles.tabLabel, remainingTabs.includes(activeTab) && styles.selectedLabel]}>{moreLabel}</Text>
        </Pressable>}
      </View>}

      <Modal
        visible={showToolIndex && !expandedTabs && !shellHidden}
        transparent
        animationType="fade"
        onRequestClose={() => setShowToolIndex(false)}
      >
        <View style={styles.indexOverlay}>
          <Pressable accessible={false} importantForAccessibility="no" style={StyleSheet.absoluteFill} onPress={() => setShowToolIndex(false)} />
          <View
            accessibilityViewIsModal
            style={[styles.indexSheet, { paddingBottom: Math.max(insets.bottom, SPACING.sm), marginLeft: insets.left, marginRight: insets.right }]}
          >
            <View style={styles.indexHeading}>
              <Text accessibilityRole="header" style={styles.indexTitle}>{toolIndexLabel}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={dismissLabel}
                style={({ pressed }) => [styles.indexClose, pressed && styles.pressed]}
                onPress={() => setShowToolIndex(false)}
              >
                <BellumIcon name="close" size={22} />
              </Pressable>
            </View>
            <ScrollView>
              {remainingTabs.map(tab => {
                const selected = activeTab === tab;
                return (
                  <Pressable
                    key={tab}
                    accessibilityRole="button"
                    accessibilityLabel={labelFor(tab)}
                    accessibilityState={{ selected }}
                    onPress={() => handleTabChange(tab)}
                    style={({ pressed }) => [styles.indexRow, selected && styles.indexRowSelected, pressed && styles.pressed]}
                  >
                    <BellumIcon name={tab} size={24} selected={selected} color={selected ? COLORS.primary : COLORS.textSecondary} />
                    <Text style={[styles.indexRowText, selected && styles.selectedLabel]}>{labelFor(tab)}</Text>
                    {selected && <BellumIcon name="check" size={18} color={COLORS.primary} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: { flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: COLORS.text, fontSize: FONT_SIZE.title, fontWeight: '800' },
  screenContainer: { flex: 1 },
  masthead: {
    minHeight: 52, paddingVertical: 2, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', gap: SPACING.sm, backgroundColor: COLORS.backgroundElevated,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  mastheadTitle: { flex: 1, minWidth: 0, paddingLeft: SPACING.sm, borderLeftWidth: 2, borderLeftColor: COLORS.primary },
  wordmark: { color: COLORS.text, fontSize: FONT_SIZE.lg, fontWeight: '800', letterSpacing: 0.2 },
  location: {
    flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 48, minWidth: 48,
    maxWidth: '48%', paddingHorizontal: SPACING.sm,
  },
  locationText: { flexShrink: 1, color: COLORS.text, fontSize: FONT_SIZE.sm, fontWeight: '600' },
  tabBar: { flexDirection: 'row', backgroundColor: COLORS.backgroundElevated, borderTopWidth: 1, borderTopColor: COLORS.border },
  tabStrip: { flexDirection: 'row' },
  tabItem: {
    flex: 1, minWidth: 48, minHeight: 56, paddingHorizontal: 2, paddingVertical: SPACING.xs,
    alignItems: 'center', justifyContent: 'center', borderTopWidth: 2, borderTopColor: 'transparent',
  },
  tabSelected: { borderTopColor: COLORS.primary },
  moreTab: { borderLeftWidth: 1, borderLeftColor: COLORS.border },
  tabLabel: { fontSize: FONT_SIZE.sm, color: COLORS.textSecondary, marginTop: 3, fontWeight: '600', textAlign: 'center' },
  selectedLabel: { color: COLORS.primary, fontWeight: '800' },
  pressed: { backgroundColor: COLORS.primarySoft },
  indexOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: COLORS.overlay },
  indexSheet: {
    maxHeight: '78%', backgroundColor: COLORS.backgroundElevated, borderTopWidth: 2, borderTopColor: COLORS.primary,
  },
  indexHeading: {
    minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingLeft: SPACING.lg,
    paddingRight: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  indexTitle: { flex: 1, color: COLORS.text, fontSize: FONT_SIZE.lg, fontWeight: '800' },
  indexClose: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  indexRow: {
    minHeight: 56, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, gap: SPACING.md,
    flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  indexRowSelected: { borderLeftWidth: 2, borderLeftColor: COLORS.primary },
  indexRowText: { flex: 1, color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '600' },
});
