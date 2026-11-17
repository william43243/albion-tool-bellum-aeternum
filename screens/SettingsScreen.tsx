import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Application from 'expo-application';
import { COLORS, SPACING, FONT_SIZE } from '../constants/theme';
import { Language } from '../lib/i18n';
import { Server, marketCacheInfo, clearMarketMemoryCache } from '../lib/api';
import PremiumInfoPanel from '../components/PremiumInfoPanel';
import UpdateSection from '../components/UpdateSection';
import ThirdPartyNotices from '../components/ThirdPartyNotices';
import { AnalyticsConsent } from '../lib/analytics';

const BTC_ADDRESS = 'bc1qcptkrekh335wvffcxnrzqkj5nqf72r538vey4x';

interface Props {
  t: (key: any) => any;
  lang: Language;
  onSwitchLanguage: (lang: Language) => void;
  server: Server;
  onSwitchServer: (server: Server) => void;
  analyticsConsent: AnalyticsConsent;
  onAnalyticsConsentChange: (choice: 'accepted' | 'refused') => void;
}

const SERVER_OPTIONS: Server[] = ['americas', 'europe', 'asia'];

export default function SettingsScreen({
  t,
  lang,
  onSwitchLanguage,
  server,
  onSwitchServer,
  analyticsConsent,
  onAnalyticsConsentChange,
}: Props) {
  const [cacheInfo,setCacheInfo]=useState(()=>marketCacheInfo());
  const cacheText=(fr:string,en:string,es:string)=>lang==='fr'?fr:lang==='es'?es:en;
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>{t('settings')}</Text>

      {/* Language */}
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('language')}</Text>
        <View style={styles.langRow}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ selected: lang === 'fr' }}
            style={[styles.langBtn, lang === 'fr' && styles.langBtnActive]}
            onPress={() => onSwitchLanguage('fr')}
          >
            <Text style={[styles.langBtnText, lang === 'fr' && styles.langBtnTextActive]}>
              {t('french')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ selected: lang === 'en' }}
            style={[styles.langBtn, lang === 'en' && styles.langBtnActive]}
            onPress={() => onSwitchLanguage('en')}
          >
            <Text style={[styles.langBtnText, lang === 'en' && styles.langBtnTextActive]}>
              {t('english')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ selected: lang === 'es' }}
            style={[styles.langBtn, lang === 'es' && styles.langBtnActive]}
            onPress={() => onSwitchLanguage('es')}
          >
            <Text style={[styles.langBtnText, lang === 'es' && styles.langBtnTextActive]}>
              {t('spanish')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{cacheText('Cache des données marché','Market data cache','Caché del mercado')}</Text>
        <Text style={styles.settingDescription}>{cacheText('Cache temporaire en mémoire :','Temporary in-memory cache:','Caché temporal en memoria:')} {cacheInfo.prices} {cacheText('prix','prices','precios')} · {cacheInfo.history} {cacheText('historiques','histories','históricos')} · {cacheInfo.other} {cacheText('autres','other','otros')} · {cacheInfo.ttlMinutes} min</Text>
        <Text style={styles.settingDescription}>{cacheText('Ce cache se vide à la fermeture de l’app. Les résultats du chat et les données enregistrées ailleurs ne sont pas inclus.','This cache clears when the app closes. Chat results and data stored elsewhere are not included.','Esta caché se borra al cerrar la app. No incluye resultados del chat ni datos guardados en otro lugar.')}</Text>
        <View style={styles.langRow}><TouchableOpacity accessibilityRole="button" style={styles.langBtn} onPress={()=>setCacheInfo(marketCacheInfo())}><Text style={styles.langBtnText}>{cacheText('Actualiser','Refresh','Actualizar')}</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" style={styles.langBtn} onPress={()=>{clearMarketMemoryCache();setCacheInfo(marketCacheInfo());}}><Text style={styles.langBtnText}>{cacheText('Vider ce cache','Clear this cache','Vaciar caché')}</Text></TouchableOpacity></View>
      </View>

      {/* Privacy-minimized product analytics */}
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('analyticsConsent')}</Text>
        <Text style={styles.settingDescription}>{t('analyticsSettingsDescription')}</Text>
        <View style={styles.langRow}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ selected: analyticsConsent === 'accepted' }}
            disabled={analyticsConsent === 'accepted'}
            style={[styles.langBtn, analyticsConsent === 'accepted' && styles.langBtnActive]}
            onPress={() => onAnalyticsConsentChange('accepted')}
          >
            <Text style={[styles.langBtnText, analyticsConsent === 'accepted' && styles.langBtnTextActive]}>
              {t('analyticsEnabled')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ selected: analyticsConsent !== 'accepted' }}
            disabled={analyticsConsent !== 'accepted'}
            style={[styles.langBtn, analyticsConsent !== 'accepted' && styles.langBtnActive]}
            onPress={() => onAnalyticsConsentChange('refused')}
          >
            <Text style={[styles.langBtnText, analyticsConsent !== 'accepted' && styles.langBtnTextActive]}>
              {t('analyticsDisabled')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Server */}
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('server')}</Text>
        <View style={styles.langRow}>
          {SERVER_OPTIONS.map((region) => (
            <TouchableOpacity
              key={region}
              accessibilityRole="button"
              accessibilityState={{ selected: server === region }}
              style={[styles.langBtn, server === region && styles.langBtnActive]}
              onPress={() => onSwitchServer(region)}
            >
              <Text style={[styles.langBtnText, server === region && styles.langBtnTextActive]}>
                {t(`server${region.charAt(0).toUpperCase() + region.slice(1)}` as any)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* In-app updates (Android only — component renders null otherwise) */}
      <UpdateSection t={t} lang={lang} />

      {/* Premium Bonuses */}
      <PremiumInfoPanel title={t('premiumBonuses')} bonuses={t('premiumBonusList')} />

      {/* Formulas Reference */}
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {t('referenceFormulas')}
        </Text>

        <View style={styles.formulaCard}>
          <Text style={styles.formulaTitle}>Marketplace</Text>
          <Text style={styles.formulaText}>Buy Order Fee = ceil(buy price × quantity × 2.5%)</Text>
          <Text style={styles.formulaText}>Sell Order Fee = ceil(sell price × quantity × 2.5%)</Text>
          <Text style={styles.formulaText}>Sales Tax = ceil(sell price × quantity × 4%) [Premium]</Text>
          <Text style={styles.formulaText}>Sales Tax = ceil(sell price × quantity × 8%) [Non-Premium]</Text>
          <Text style={styles.formulaText}>Buy and sell orders are selected independently.</Text>
        </View>

        <View style={styles.formulaCard}>
          <Text style={styles.formulaTitle}>Crafting</Text>
          <Text style={styles.formulaText}>Nutrition = Item Value × 0.1125</Text>
          <Text style={styles.formulaText}>Fee = (IV × 0.1125 × Tax) / 100</Text>
        </View>
      </View>

      {/* Sources */}
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('credits')}</Text>

        <TouchableOpacity
          accessibilityRole="link"
          style={styles.linkRow}
          onPress={() => Linking.openURL('https://wiki.albiononline.com/wiki/Marketplace')}
        >
          <Text style={styles.linkText}>Albion Online Wiki - Marketplace</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="link"
          style={styles.linkRow}
          onPress={() => Linking.openURL('https://wiki.albiononline.com/wiki/Margin')}
        >
          <Text style={styles.linkText}>Albion Online Wiki - Margin</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="link"
          style={styles.linkRow}
          onPress={() => Linking.openURL('https://www.albion-online-data.com/')}
        >
          <Text style={styles.linkText}>Albion Online Data Project (API)</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="link"
          style={styles.linkRow}
          onPress={() => Linking.openURL('https://github.com/ao-data/ao-bin-dumps')}
        >
          <Text style={styles.linkText}>ao-data/ao-bin-dumps (Item Data)</Text>
        </TouchableOpacity>
      </View>

      {/* Donate */}
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {t('donate')}
        </Text>
        <View style={styles.donateCard}>
          <Text style={styles.donateText}>
            {t('donateText')}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.btcAddressBox}
            onPress={async () => {
              await Clipboard.setStringAsync(BTC_ADDRESS);
              Alert.alert(t('copiedAlert'), t('copiedMsg'));
            }}
          >
            <Text style={styles.btcAddress} numberOfLines={1} ellipsizeMode="middle">
              {BTC_ADDRESS}
            </Text>
            <Text style={styles.btcCopyHint}>
              {t('tapToCopy')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Version */}
      <ThirdPartyNotices lang={lang} />
      <View style={styles.versionBox}>
        <Text style={styles.versionText}>Albion Market</Text>
        <Text style={styles.versionNumber}>
          v{Application.nativeApplicationVersion ?? '2.0.4'}
        </Text>
        <Text style={styles.versionSub}>
          {t('priceData')}
        </Text>
        <Text style={styles.versionSub}>
          {t('notAffiliated')}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl * 2 },
  title: { color: COLORS.text, fontSize: FONT_SIZE.title, fontWeight: '800', letterSpacing: -0.4, marginBottom: SPACING.lg },
  section: { marginBottom: SPACING.lg, paddingTop: SPACING.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  sectionTitle: { color: COLORS.text, fontSize: FONT_SIZE.lg, fontWeight: '800', marginBottom: SPACING.sm },
  settingDescription: { color: COLORS.textSecondary, fontSize: FONT_SIZE.sm, lineHeight: 20, marginBottom: SPACING.sm },
  langRow: { flexDirection: 'row', gap: SPACING.xs, alignItems: 'stretch' },
  langBtn: { flex: 1, minWidth: 0, minHeight: 48, paddingVertical: 6, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 3, backgroundColor: COLORS.card, borderWidth: 1, borderBottomWidth: 2, borderColor: COLORS.borderStrong },
  langBtnActive: { backgroundColor: COLORS.primarySoft, borderColor: COLORS.primary },
  langBtnText: { color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '500', textAlign: 'center' },
  langBtnTextActive: { color: COLORS.primary, fontWeight: '800' },
  formulaCard: { backgroundColor: COLORS.card, padding: SPACING.md, borderTopWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border },
  formulaTitle: { color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '800', marginBottom: SPACING.xs },
  formulaText: { color: COLORS.text, fontSize: FONT_SIZE.sm, fontFamily: 'monospace', marginBottom: 2 },
  linkRow: { minHeight: 48, justifyContent: 'center', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  linkText: { color: COLORS.primary, fontSize: FONT_SIZE.md, textDecorationLine: 'underline' },
  versionBox: { paddingVertical: SPACING.lg, marginTop: SPACING.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  versionText: { color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '800' },
  versionNumber: { color: COLORS.textSecondary, fontVariant: ['tabular-nums'], fontSize: FONT_SIZE.sm, marginTop: SPACING.xs },
  versionSub: { color: COLORS.textSecondary, fontSize: FONT_SIZE.sm, marginTop: SPACING.xs },
  donateCard: { gap: SPACING.sm },
  donateText: { color: COLORS.textSecondary, fontSize: FONT_SIZE.sm, lineHeight: 20 },
  btcAddressBox: { backgroundColor: COLORS.card, borderRadius: 3, padding: SPACING.sm, minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: COLORS.borderStrong },
  btcAddress: { color: COLORS.text, fontSize: FONT_SIZE.sm, fontFamily: 'monospace', fontWeight: '600' },
  btcCopyHint: { color: COLORS.primary, fontSize: FONT_SIZE.sm, marginTop: SPACING.xs },
});
