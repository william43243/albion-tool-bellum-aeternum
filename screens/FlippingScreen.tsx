import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';
import { calculateFlipProfit } from '../lib/calculations';
import { Language } from '../lib/i18n';
import {
  captureAnalyticsAuthorization,
  isAnalyticsAuthorizationCurrent,
  trackFlipCalculation,
} from '../lib/analytics';
import { parseUserNumber } from '../lib/numberParsing';
import NumberInput from '../components/NumberInput';
import PremiumToggle from '../components/PremiumToggle';
import ResultCard from '../components/ResultCard';

interface Props {
  t: (key: any) => any;
  lang: Language;
  isPremium: boolean;
  onPremiumChange: (value: boolean) => void;
}

export default function FlippingScreen({ t, lang, isPremium, onPremiumChange }: Props) {
  const [buyPrice, setBuyPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [useBuyOrder, setUseBuyOrder] = useState(true);
  const [useSellOrder, setUseSellOrder] = useState(true);

  // Pure calculation — no side effects. Recomputes in real time on every input.
  const result = useMemo(() => {
    const buy = parseUserNumber(buyPrice, false, lang);
    const sell = parseUserNumber(sellPrice, false, lang);
    const qty = parseUserNumber(quantity, true, lang);
    if (!buy.valid || !sell.valid || !qty.valid || qty.value <= 0) return null;
    if (buy.value <= 0 && sell.value <= 0) return null;
    return calculateFlipProfit(buy.value, sell.value, qty.value, isPremium, useBuyOrder, useSellOrder);
  }, [buyPrice, sellPrice, quantity, lang, isPremium, useBuyOrder, useSellOrder]);

  const trackedFirstValidRef = useRef(false);

  // Track one completed calculation per valid scenario entry, not every
  // keystroke/recalculation while the user is still typing.
  useEffect(() => {
    if (!result) {
      trackedFirstValidRef.current = false;
      return;
    }
    if (trackedFirstValidRef.current) return;
    const authorization = captureAnalyticsAuthorization();
    if (authorization === null) return;
    const id = setTimeout(() => {
      if (!isAnalyticsAuthorizationCurrent(authorization)) return;
      trackFlipCalculation();
      trackedFirstValidRef.current = true;
    }, 1000);
    return () => clearTimeout(id);
  }, [result]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('flipping')}</Text>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>{t('flippingInfo')}</Text>
      </View>

      <PremiumToggle
        isPremium={isPremium}
        onToggle={onPremiumChange}
        labelOn={t('premium')}
        labelOff={t('nonPremium')}
      />

      <View style={styles.orderToggle}>
        <TouchableOpacity
          style={[styles.orderBtn, useBuyOrder && styles.orderBtnActive]}
          onPress={() => setUseBuyOrder((value) => !value)}
        >
          <Text style={[styles.orderBtnText, useBuyOrder && styles.orderBtnTextActive]}>{t('useBuyOrder')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.orderBtn, useSellOrder && styles.orderBtnActive]}
          onPress={() => setUseSellOrder((value) => !value)}
        >
          <Text style={[styles.orderBtnText, useSellOrder && styles.orderBtnTextActive]}>{t('useSellOrder')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {lang === 'fr' ? "1. Prix d'achat" : '1. Buy price'}
        </Text>
        <NumberInput
          locale={lang}
          label={t('buyPrice')}
          value={buyPrice}
          onChangeText={setBuyPrice}
          info={lang === 'fr' ? "Prix unitaire d'achat" : 'Unit purchase price'}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {lang === 'fr' ? '2. Prix de vente' : '2. Sell price'}
        </Text>
        <NumberInput
          locale={lang}
          label={t('sellPrice')}
          value={sellPrice}
          onChangeText={setSellPrice}
        />
      </View>

      <NumberInput
          locale={lang}
        label={t('quantity')}
        value={quantity}
        onChangeText={setQuantity}
        integer
      />

      {result && (
        <>
          <ResultCard
            title={lang === 'fr' ? 'Résultat Flipping' : 'Flipping Result'}
            highlight={{
              value: result.totalProfit,
              label: result.totalProfit >= 0 ? t('profit') : t('loss'),
            }}
            rows={[
              {
                label: t('buyPrice'),
                value: `${result.marketplace.buyPrice * result.marketplace.quantity} silver`,
              },
              ...(useBuyOrder
                ? [
                    { label: t('setupFeeBuy'), value: `${result.marketplace.setupFeeBuy} silver` },
                  ]
                : []),
              ...(useSellOrder
                ? [
                    { label: t('setupFeeSell'), value: `${result.marketplace.setupFeeSell} silver` },
                  ]
                : []),
              { label: t('salesTax'), value: `${result.marketplace.salesTax} silver` },
              {
                label: t('fees') + ' ' + t('total'),
                value: `${result.totalFees} silver`,
                bold: true,
                color: COLORS.loss,
              },
              {
                label: t('upfrontInvestment'),
                value: `${result.upfrontInvestment} silver`,
                bold: true,
              },
              {
                label: t('roi'),
                value: `${result.roi.toFixed(1)}%`,
                color: result.roi >= 0 ? COLORS.profit : COLORS.loss,
                bold: true,
              },
            ]}
          />
        </>
      )}
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
    marginBottom: SPACING.md,
  },
  infoBox: {
    backgroundColor: COLORS.info + '15',
    borderRadius: 8,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.info,
  },
  infoText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
  },
  section: {
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    color: COLORS.primary,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  orderToggle: {
    flexDirection: 'row',
    marginBottom: SPACING.lg,
    gap: SPACING.sm,
  },
  orderBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  orderBtnActive: {
    backgroundColor: COLORS.primary + '20',
    borderColor: COLORS.primary,
  },
  orderBtnText: { color: COLORS.textMuted, fontSize: FONT_SIZE.sm },
  orderBtnTextActive: { color: COLORS.primary, fontWeight: '600' },
});
