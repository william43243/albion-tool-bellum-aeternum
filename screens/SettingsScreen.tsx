import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Application from 'expo-application';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';
import { Language } from '../lib/i18n';
import { Server } from '../lib/api';
import PremiumInfoPanel from '../components/PremiumInfoPanel';
import UpdateSection from '../components/UpdateSection';

const BTC_ADDRESS = 'bc1qcptkrekh335wvffcxnrzqkj5nqf72r538vey4x';

interface Props {
  t: (key: any) => any;
  lang: Language;
  onSwitchLanguage: (lang: Language) => void;
  server: Server;
  onSwitchServer: (server: Server) => void;
}

const SERVER_OPTIONS: { key: Server; flag: string }[] = [
  { key: 'americas', flag: '\uD83C\uDDFA\uD83C\uDDF8' },
  { key: 'europe', flag: '\uD83C\uDDEA\uD83C\uDDFA' },
  { key: 'asia', flag: '\uD83C\uDDEF\uD83C\uDDF5' },
];

export default function SettingsScreen({ t, lang, onSwitchLanguage, server, onSwitchServer }: Props) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('settings')}</Text>

      {/* Language */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('language')}</Text>
        <View style={styles.langRow}>
          <TouchableOpacity
            style={[styles.langBtn, lang === 'fr' && styles.langBtnActive]}
            onPress={() => onSwitchLanguage('fr')}
          >
            <Text style={[styles.langBtnText, lang === 'fr' && styles.langBtnTextActive]}>
              🇫🇷 {t('french')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.langBtn, lang === 'en' && styles.langBtnActive]}
            onPress={() => onSwitchLanguage('en')}
          >
            <Text style={[styles.langBtnText, lang === 'en' && styles.langBtnTextActive]}>
              🇬🇧 {t('english')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.langBtn, lang === 'es' && styles.langBtnActive]}
            onPress={() => onSwitchLanguage('es')}
          >
            <Text style={[styles.langBtnText, lang === 'es' && styles.langBtnTextActive]}>
              🇪🇸 {t('spanish')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Server */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('server')}</Text>
        <View style={styles.langRow}>
          {SERVER_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.langBtn, server === opt.key && styles.langBtnActive]}
              onPress={() => onSwitchServer(opt.key)}
            >
              <Text style={[styles.langBtnText, server === opt.key && styles.langBtnTextActive]}>
                {opt.flag} {t(`server${opt.key.charAt(0).toUpperCase() + opt.key.slice(1)}` as any)}
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
        <Text style={styles.sectionTitle}>
          {t('referenceFormulas')}
        </Text>

        <View style={styles.formulaCard}>
          <Text style={styles.formulaTitle}>Marketplace</Text>
          <Text style={styles.formulaText}>Setup Fee = ceil(price × 2.5%)</Text>
          <Text style={styles.formulaText}>Sales Tax = ceil(price × 4%) [Premium]</Text>
          <Text style={styles.formulaText}>Sales Tax = ceil(price × 8%) [Non-Premium]</Text>
        </View>

        <View style={styles.formulaCard}>
          <Text style={styles.formulaTitle}>Crafting</Text>
          <Text style={styles.formulaText}>Nutrition = Item Value × 0.1125</Text>
          <Text style={styles.formulaText}>Fee = (IV × 0.1125 × Tax) / 100</Text>
        </View>
      </View>

      {/* Sources */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('credits')}</Text>

        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => Linking.openURL('https://wiki.albiononline.com/wiki/Marketplace')}
        >
          <Text style={styles.linkText}>📖 Albion Online Wiki - Marketplace</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => Linking.openURL('https://wiki.albiononline.com/wiki/Margin')}
        >
          <Text style={styles.linkText}>📖 Albion Online Wiki - Margin</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => Linking.openURL('https://www.albion-online-data.com/')}
        >
          <Text style={styles.linkText}>📊 Albion Online Data Project (API)</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => Linking.openURL('https://github.com/ao-data/ao-bin-dumps')}
        >
          <Text style={styles.linkText}>💾 ao-data/ao-bin-dumps (Item Data)</Text>
        </TouchableOpacity>
      </View>

      {/* Donate */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {t('donate')}
        </Text>
        <View style={styles.donateCard}>
          <Text style={styles.donateIcon}>₿</Text>
          <Text style={styles.donateText}>
            {t('donateText')}
          </Text>
          <TouchableOpacity
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
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl * 2,
  },
  title: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.title,
    fontWeight: '800',
    marginBottom: SPACING.lg,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    marginBottom: SPACING.md,
  },
  langRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  langBtn: {
    flex: 1,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  langBtnActive: {
    backgroundColor: COLORS.primary + '20',
    borderColor: COLORS.primary,
  },
  langBtnText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    fontWeight: '500',
  },
  langBtnTextActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  formulaCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  formulaTitle: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    marginBottom: SPACING.xs,
  },
  formulaText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.sm,
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  linkRow: {
    paddingVertical: SPACING.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border + '40',
  },
  linkText: {
    color: COLORS.info,
    fontSize: FONT_SIZE.md,
  },
  versionBox: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    marginTop: SPACING.lg,
  },
  versionText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.md,
    fontWeight: '600',
  },
  versionNumber: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
    marginTop: SPACING.xs,
  },
  versionSub: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: SPACING.xs,
    textAlign: 'center',
  },
  donateCard: {
    backgroundColor: '#1a1500',
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: '#F7931A40',
    alignItems: 'center',
  },
  donateIcon: {
    fontSize: 36,
    color: '#F7931A',
    marginBottom: SPACING.sm,
  },
  donateText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
    textAlign: 'center',
    marginBottom: SPACING.md,
    lineHeight: 20,
  },
  btcAddressBox: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F7931A60',
  },
  btcAddress: {
    color: '#F7931A',
    fontSize: FONT_SIZE.sm,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  btcCopyHint: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginTop: SPACING.xs,
  },
});
