import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { COLORS, SPACING, FONT_SIZE } from '../constants/theme';
import { calculateFlippingProfit } from '../lib/calculations';
import { Language } from '../lib/i18n';
import NumberInput from '../components/NumberInput';
import PremiumToggle from '../components/PremiumToggle';
import ResultCard from '../components/ResultCard';

interface Props {
  t: (key: any) => any;
  lang: Language;
}

export default function FlippingScreen({ t, lang }: Props) {
  const [materialBuyPrice, setMaterialBuyPrice] = useState('');
  const [productSellPrice, setProductSellPrice] = useState('');
  const [craftingItemValue, setCraftingItemValue] = useState('');
  const [stationTax, setStationTax] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [isPremium, setIsPremium] = useState(true);
  const [useOrders, setUseOrders] = useState(true);

  const result = useMemo(() => {
    const matBuy = parseFloat(materialBuyPrice) || 0;
    const prodSell = parseFloat(productSellPrice) || 0;
    const craftIV = parseFloat(craftingItemValue) || 0;
    const tax = parseFloat(stationTax) || 0;
    const qty = parseInt(quantity) || 1;
    if (matBuy <= 0 && prodSell <= 0) return null;
    return calculateFlippingProfit(matBuy, prodSell, craftIV, tax, qty, isPremium, useOrders);
  }, [materialBuyPrice, productSellPrice, craftingItemValue, stationTax, quantity, isPremium, useOrders]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('flipping')}</Text>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>{t('flippingInfo')}</Text>
      </View>

      <PremiumToggle
        isPremium={isPremium}
        onToggle={setIsPremium}
        labelOn={t('premium')}
        labelOff={t('nonPremium')}
      />

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {lang === 'fr' ? '1. Achat Matériaux' : '1. Buy Materials'}
        </Text>
        <NumberInput
          label={t('materialCost')}
          value={materialBuyPrice}
          onChangeText={setMaterialBuyPrice}
          info={lang === 'fr' ? 'Prix unitaire des matériaux' : 'Unit price of materials'}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {lang === 'fr' ? '2. Craft' : '2. Craft'}
        </Text>
        <NumberInput
          label={t('itemValue')}
          value={craftingItemValue}
          onChangeText={setCraftingItemValue}
          info={lang === 'fr' ? "Item Value du produit crafté" : "Item Value of crafted product"}
        />
        <NumberInput
          label={t('stationTax')}
          value={stationTax}
          onChangeText={setStationTax}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {lang === 'fr' ? '3. Vente Produit Fini' : '3. Sell Product'}
        </Text>
        <NumberInput
          label={t('productPrice')}
          value={productSellPrice}
          onChangeText={setProductSellPrice}
        />
      </View>

      <NumberInput
        label={t('quantity')}
        value={quantity}
        onChangeText={setQuantity}
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
                label: t('materialCost'),
                value: `${result.marketplace.buyPrice * result.marketplace.quantity} silver`,
              },
              ...(useOrders
                ? [
                    { label: t('setupFeeBuy'), value: `${result.marketplace.setupFeeBuy} silver` },
                    { label: t('setupFeeSell'), value: `${result.marketplace.setupFeeSell} silver` },
                  ]
                : []),
              { label: t('salesTax'), value: `${result.marketplace.salesTax} silver` },
              { label: t('craftingCost'), value: `${result.crafting.totalFee} silver` },
              {
                label: t('fees') + ' ' + t('total'),
                value: `${result.totalFees} silver`,
                bold: true,
                color: COLORS.loss,
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
});
