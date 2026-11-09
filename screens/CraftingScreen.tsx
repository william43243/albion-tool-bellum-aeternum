import React, { useState, useMemo, useRef, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';
import { calculateCraftingFee } from '../lib/calculations';
import { captureAnalyticsAuthorization, isAnalyticsAuthorizationCurrent, trackCraftCalculation } from '../lib/analytics';
import { CraftingAnalytics } from '../lib/craftingAnalytics';
import { Language } from '../lib/i18n';
import { parseUserNumber } from '../lib/numberParsing';
import { selectCraftingItemValue, needsManualCraftingItemValue } from '../lib/craftingItemValue';
import { useLocalizedNumberInput } from '../hooks/useLocalizedNumberInput';
import NumberInput from '../components/NumberInput';
import ResultCard from '../components/ResultCard';
import PremiumInfoPanel from '../components/PremiumInfoPanel';
import ItemPicker from '../components/ItemPicker';

interface Props {
  t: (key: any) => any;
  lang: Language;
  active: boolean;
}

export default function CraftingScreen({ t, lang, active }: Props) {
  const [itemValue, setItemValue] = useLocalizedNumberInput<string>('', lang);
  const [catalogValueMissing, setCatalogValueMissing] = useState(false);
  const [stationTax, setStationTax] = useLocalizedNumberInput<string>('', lang);
  const [quantity, setQuantity] = useLocalizedNumberInput<string>('1', lang);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const tracker = useRef<CraftingAnalytics | null>(null);
  if (!tracker.current) tracker.current = new CraftingAnalytics(isAnalyticsAuthorizationCurrent, trackCraftCalculation);
  useEffect(() => {
    if (!active) tracker.current?.cancel();
    return () => tracker.current?.cancel();
  }, [active, lang]);
  function recordInput(nextValue: string, nextTax: string, nextQuantity: string) {
    if (!active) return;
    const value = parseUserNumber(nextValue, false, lang);
    const tax = nextTax.trim() ? parseUserNumber(nextTax, false, lang) : { value: 0, valid: true };
    const qty = parseUserNumber(nextQuantity, true, lang);
    const signature = value.valid && tax.valid && qty.valid && value.value > 0 && qty.value > 0
      ? `${value.value}:${tax.value}:${qty.value}` : null;
    tracker.current?.update(signature, captureAnalyticsAuthorization());
  }
  function changeItemValue(value: string) { setItemValue(value); recordInput(value, stationTax, quantity); }
  function changeStationTax(value: string) { setStationTax(value); recordInput(itemValue, value, quantity); }
  function changeQuantity(value: string) { setQuantity(value); recordInput(itemValue, stationTax, value); }


  const iv = useMemo(() => parseUserNumber(itemValue, false, lang), [itemValue, lang]);
  const manualItemValueNeeded = needsManualCraftingItemValue(catalogValueMissing, iv);

  const result = useMemo(() => {
    const tax = stationTax.trim()
      ? parseUserNumber(stationTax, false, lang)
      : { value: 0, valid: true };
    const qty = parseUserNumber(quantity, true, lang);
    if (!iv.valid || !tax.valid || !qty.valid || iv.value <= 0 || qty.value <= 0) return null;
    return calculateCraftingFee(iv.value, tax.value, qty.value);
  }, [iv, stationTax, quantity, lang]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('crafting')}</Text>

      <TouchableOpacity
        style={styles.selectBtn}
        onPress={() => setShowItemPicker(true)}
      >
        <Text style={styles.selectBtnText}>{t('selectItem')}</Text>
      </TouchableOpacity>

      <NumberInput
        locale={lang}
        label={t('itemValue')}
        value={itemValue}
        onChangeText={changeItemValue}
        placeholder="ex: 1024"
      />

      {manualItemValueNeeded && (
        <View style={styles.infoBox} accessibilityRole="alert">
          <Text style={styles.infoText}>{t('itemValueUnavailable')}</Text>
        </View>
      )}

      <NumberInput
        locale={lang}
        label={t('stationTax')}
        value={stationTax}
        onChangeText={changeStationTax}
        placeholder="ex: 800"
        info={lang === 'fr'
          ? 'Le nombre affiché en jeu (fee par 100 nutrition)'
          : 'The number shown in-game (fee per 100 nutrition)'}
      />

      <NumberInput
        locale={lang}
        label={t('quantity')}
        value={quantity}
        onChangeText={changeQuantity}
        integer
      />

      {result && (
        <ResultCard
          title={t('result')}
          highlight={{
            value: -result.totalFee,
            label: t('totalCraftingFee'),
          }}
          rows={[
            {
              label: t('nutritionPerItem'),
              value: `${result.nutritionPerItem.toFixed(2)}`,
            },
            {
              label: t('totalNutrition'),
              value: `${result.totalNutrition.toFixed(2)}`,
            },
            {
              label: t('craftingFee') + ' (' + t('perItem') + ')',
              value: `${result.feePerItem.toFixed(2)} silver`,
            },
            {
              label: t('totalCraftingFee'),
              value: `${result.totalFee} silver`,
              color: COLORS.loss,
              bold: true,
            },
          ]}
        />
      )}

      <View style={styles.infoBox}>
        <Text style={styles.infoIcon}>ℹ️</Text>
        <Text style={styles.infoText}>{t('craftingFeeInfo')}</Text>
      </View>

      <View style={styles.formulaBox}>
        <Text style={styles.formulaTitle}>
          {lang === 'fr' ? 'Formules :' : 'Formulas:'}
        </Text>
        <Text style={styles.formulaText}>
          Nutrition = Item Value × 0.1125
        </Text>
        <Text style={styles.formulaText}>
          Fee = (Item Value × 0.1125 × Station Tax) / 100
        </Text>
      </View>

      <PremiumInfoPanel title={t('premiumBonuses')} bonuses={t('premiumBonusList')} />

      <ItemPicker
        visible={showItemPicker}
        onClose={() => setShowItemPicker(false)}
        onSelect={(item) => {
          const selection = selectCraftingItemValue(item.iv, lang);
          changeItemValue(selection.itemValue);
          setCatalogValueMissing(selection.catalogValueMissing);
          setShowItemPicker(false);
        }}
        lang={lang}
      />
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
  selectBtn: {
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg,
  },
  selectBtnText: {
    color: COLORS.primary,
    fontWeight: '600',
    fontSize: FONT_SIZE.md,
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: COLORS.info + '15',
    borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.md,
    marginVertical: SPACING.sm,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.info,
  },
  infoIcon: {
    marginRight: SPACING.sm,
    fontSize: FONT_SIZE.md,
  },
  infoText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
    flex: 1,
  },
  formulaBox: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginVertical: SPACING.sm,
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
    marginBottom: SPACING.xs,
  },
});
