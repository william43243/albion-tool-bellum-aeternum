import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';
import { calculateCraftingFee } from '../lib/calculations';
import { Language } from '../lib/i18n';
import NumberInput from '../components/NumberInput';
import ResultCard from '../components/ResultCard';
import PremiumInfoPanel from '../components/PremiumInfoPanel';
import ItemPicker from '../components/ItemPicker';

interface Props {
  t: (key: any) => any;
  lang: Language;
}

export default function CraftingScreen({ t, lang }: Props) {
  const [itemValue, setItemValue] = useState('');
  const [stationTax, setStationTax] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [showItemPicker, setShowItemPicker] = useState(false);

  const result = useMemo(() => {
    const iv = parseFloat(itemValue) || 0;
    const tax = parseFloat(stationTax) || 0;
    const qty = parseInt(quantity) || 1;
    if (iv <= 0) return null;
    return calculateCraftingFee(iv, tax, qty);
  }, [itemValue, stationTax, quantity]);

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
        label={t('itemValue')}
        value={itemValue}
        onChangeText={setItemValue}
        placeholder="ex: 1024"
      />

      <NumberInput
        label={t('stationTax')}
        value={stationTax}
        onChangeText={setStationTax}
        placeholder="ex: 800"
        info={lang === 'fr'
          ? 'Le nombre affiché en jeu (fee par 100 nutrition)'
          : 'The number shown in-game (fee per 100 nutrition)'}
      />

      <NumberInput
        label={t('quantity')}
        value={quantity}
        onChangeText={setQuantity}
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
          setItemValue(String(item.iv));
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
