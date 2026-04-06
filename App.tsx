import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Dimensions } from 'react-native';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import { useLanguage } from './hooks/useLanguage';
import { useServer } from './hooks/useServer';
import { COLORS, SPACING, FONT_SIZE } from './constants/theme';
import { trackPageView, trackToolUse } from './lib/analytics';

import MarketplaceScreen from './screens/MarketplaceScreen';
import CraftingScreen from './screens/CraftingScreen';
import FlippingScreen from './screens/FlippingScreen';
import HistoryScreen from './screens/HistoryScreen';
import AdvisorScreen from './screens/AdvisorScreen';
import SettingsScreen from './screens/SettingsScreen';

type TabKey = 'marketplace' | 'crafting' | 'flipping' | 'history' | 'advisor' | 'settings';

const TAB_ICONS: Record<TabKey, string> = {
  marketplace: '\u{1F4B0}',
  crafting: '\u{1F528}',
  flipping: '\u{1F504}',
  history: '\u{1F4C8}',
  advisor: '\u{1F9E0}',
  settings: '\u{2699}\uFE0F',
};

const TABS: TabKey[] = ['marketplace', 'crafting', 'flipping', 'history', 'advisor', 'settings'];

function AppContent() {
  const { lang, switchLanguage, t, loaded } = useLanguage();
  const { server, switchServer, serverLoaded } = useServer();
  const [activeTab, setActiveTab] = useState<TabKey>('marketplace');
  const insets = useSafeAreaInsets();

  // Track initial page view
  useEffect(() => {
    trackPageView('/marketplace');
  }, []);

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    trackPageView('/' + tab);
    trackToolUse(tab);
  };

  if (!loaded || !serverLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Albion Market</Text>
      </View>
    );
  }

  const renderScreen = () => {
    switch (activeTab) {
      case 'marketplace':
        return <MarketplaceScreen t={t} lang={lang} server={server} />;
      case 'crafting':
        return <CraftingScreen t={t} lang={lang} />;
      case 'flipping':
        return <FlippingScreen t={t} lang={lang} />;
      case 'history':
        return <HistoryScreen t={t} lang={lang} server={server} />;
      case 'advisor':
        return <AdvisorScreen t={t} lang={lang} server={server} />;
      case 'settings':
        return <SettingsScreen t={t} lang={lang} onSwitchLanguage={switchLanguage} server={server} onSwitchServer={switchServer} />;
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" translucent backgroundColor="transparent" />

      {/* Top safe area spacer */}
      <View style={{ height: insets.top, backgroundColor: COLORS.background }} />

      {/* Screen content */}
      <View style={styles.screenContainer}>{renderScreen()}</View>

      {/* Tab bar with bottom safe area */}
      <View
        style={[
          styles.tabBar,
          { paddingBottom: Math.max(insets.bottom, 12) },
        ]}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <TouchableOpacity
              key={tab}
              style={styles.tabItem}
              onPress={() => handleTabChange(tab)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabIcon, isActive && styles.tabIconActive]}>
                {TAB_ICONS[tab]}
              </Text>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {t(tab)}
              </Text>
            </TouchableOpacity>
          );
        })}
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
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.title,
    fontWeight: '800',
  },
  screenContainer: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tabIcon: {
    fontSize: 22,
    opacity: 0.4,
  },
  tabIconActive: {
    opacity: 1,
  },
  tabLabel: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
    marginTop: 3,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },
});
