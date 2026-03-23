import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';
import { calculateMarketplaceProfit } from '../lib/calculations';
import { Language } from '../lib/i18n';
import { fetchCurrentPrices, CITIES, City } from '../lib/api';
import { AlbionItem } from '../lib/items';
import NumberInput from '../components/NumberInput';
import PremiumToggle from '../components/PremiumToggle';
import ResultCard from '../components/ResultCard';
import PremiumInfoPanel from '../components/PremiumInfoPanel';
import ItemPicker from '../components/ItemPicker';

interface Props {
  t: (key: any) => any;
  lang: Language;
}

export default function MarketplaceScreen({ t, lang }: Props) {
  const [buyPrice, setBuyPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [isPremium, setIsPremium] = useState(true);
  const [useOrders, setUseOrders] = useState(true);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedCity, setSelectedCity] = useState<City>('Caerleon');

  const result = useMemo(() => {
    const buy = parseFloat(buyPrice) || 0;
    const sell = parseFloat(sellPrice) || 0;
    const qty = parseInt(quantity) || 1;
    if (buy <= 0 && sell <= 0) return null;
    return calculateMarketplaceProfit(buy, sell, qty, isPremium, useOrders);
  }, [buyPrice, sellPrice, quantity, isPremium, useOrders]);

  const handleFetchPrices = async (item: AlbionItem) => {
    setLoading(true);
    try {
      const prices = await fetchCurrentPrices(item.id, [selectedCity]);
      const cityPrice = prices.find((p) => p.city === selectedCity);
      if (cityPrice) {
        if (cityPrice.buy_price_max > 0) setBuyPrice(String(cityPrice.buy_price_max));
        if (cityPrice.sell_price_min > 0) setSellPrice(String(cityPrice.sell_price_min));
      } else {
        Alert.alert(t('error'), t('noData'));
      }
    } catch (e) {
      Alert.alert(t('error'), String(e));
    }
    setLoading(false);
  };

  const copyResult = async () => {
    if (!result) return;
    const text = `${t('netProfit')}: ${result.netProfit} silver | ${t('feePercentage')}: ${result.feePercentage.toFixed(1)}% | ${t('marginPercentage')}: ${result.marginPercentage.toFixed(1)}%`;
    await Clipboard.setStringAsync(text);
    Alert.alert(t('copied'));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('marketplace')}</Text>

      {/* Premium Toggle */}
      <PremiumToggle
        isPremium={isPremium}
        onToggle={setIsPremium}
        labelOn={t('premium')}
        labelOff={t('nonPremium')}
      />

      {/* Order Type */}
      <View style={styles.orderToggle}>
        <TouchableOpacity
          style={[styles.orderBtn, useOrders && styles.orderBtnActive]}
          onPress={() => setUseOrders(true)}
        >
          <Text style={[styles.orderBtnText, useOrders && styles.orderBtnTextActive]}>
            {t('useOrders')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.orderBtn, !useOrders && styles.orderBtnActive]}
          onPress={() => setUseOrders(false)}
        >
          <Text style={[styles.orderBtnText, !useOrders && styles.orderBtnTextActive]}>
            {t('directTrade')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Fetch Live Prices */}
      <View style={styles.fetchRow}>
        <View style={styles.cityPicker}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {CITIES.map((city) => (
              <TouchableOpacity
                key={city}
                style={[styles.cityChip, selectedCity === city && styles.cityChipActive]}
                onPress={() => setSelectedCity(city)}
              >
                <Text
                  style={[
                    styles.cityChipText,
                    selectedCity === city && styles.cityChipTextActive,
                  ]}
                >
                  {city}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
        <TouchableOpacity
          style={styles.fetchBtn}
          onPress={() => setShowItemPicker(true)}
          disabled={loading}
        >
          <Text style={styles.fetchBtnText}>
            {loading ? t('loading') : t('fetchLive')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Inputs */}
      <NumberInput
        label={t('buyPrice')}
        value={buyPrice}
        onChangeText={setBuyPrice}
        info={useOrders ? t('setupFeeInfo') : undefined}
      />
      <NumberInput
        label={t('sellPrice')}
        value={sellPrice}
        onChangeText={setSellPrice}
        info={t('salesTaxInfo')}
      />
      <NumberInput
        label={t('quantity')}
        value={quantity}
        onChangeText={setQuantity}
      />

      {/* Results */}
      {result && (
        <>
          <ResultCard
            title={t('result')}
            highlight={{
              value: result.netProfit,
              label: result.netProfit >= 0 ? t('profit') : t('loss'),
            }}
            rows={[
              ...(useOrders
                ? [
                    { label: t('setupFeeBuy'), value: `${result.setupFeeBuy} silver` },
                    { label: t('setupFeeSell'), value: `${result.setupFeeSell} silver` },
                  ]
                : []),
              { label: t('salesTax'), value: `${result.salesTax} silver` },
              {
                label: t('fees') + ' ' + t('total'),
                value: `${result.totalFees} silver`,
                bold: true,
              },
              {
                label: t('netProfit'),
                value: `${result.netProfit} silver`,
                color: result.netProfit >= 0 ? COLORS.profit : COLORS.loss,
                bold: true,
              },
              {
                label: t('perItem'),
                value: `${Math.round(result.profitPerItem)} silver`,
                color: result.profitPerItem >= 0 ? COLORS.profit : COLORS.loss,
              },
              { label: t('feePercentage'), value: `${result.feePercentage.toFixed(1)}%` },
              {
                label: t('marginPercentage'),
                value: `${result.marginPercentage.toFixed(1)}%`,
                color: result.marginPercentage >= 0 ? COLORS.profit : COLORS.loss,
              },
            ]}
          />

          {/* Visual Bar */}
          <View style={styles.barContainer}>
            <View style={styles.barRow}>
              <Text style={styles.barLabel}>{t('profit')}</Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${Math.min(100, Math.max(0, (result.netProfit / (result.sellPrice * result.quantity)) * 100))}%`,
                      backgroundColor:
                        result.netProfit >= 0 ? COLORS.profit : COLORS.loss,
                    },
                  ]}
                />
              </View>
            </View>
            <View style={styles.barRow}>
              <Text style={styles.barLabel}>{t('fees')}</Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${Math.min(100, result.feePercentage)}%`,
                      backgroundColor: COLORS.warning,
                    },
                  ]}
                />
              </View>
            </View>
          </View>

          <TouchableOpacity style={styles.copyBtn} onPress={copyResult}>
            <Text style={styles.copyBtnText}>{t('copy')}</Text>
          </TouchableOpacity>
        </>
      )}

      <PremiumInfoPanel title={t('premiumBonuses')} bonuses={t('premiumBonusList')} />

      <ItemPicker
        visible={showItemPicker}
        onClose={() => setShowItemPicker(false)}
        onSelect={handleFetchPrices}
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
  orderToggle: {
    flexDirection: 'row',
    marginTop: SPACING.md,
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
  orderBtnText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
  },
  orderBtnTextActive: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  fetchRow: {
    marginBottom: SPACING.lg,
  },
  cityPicker: {
    marginBottom: SPACING.sm,
  },
  cityChip: {
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.xs + 1,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: SPACING.xs,
  },
  cityChipActive: {
    backgroundColor: COLORS.info + '20',
    borderColor: COLORS.info,
  },
  cityChipText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
  },
  cityChipTextActive: {
    color: COLORS.info,
    fontWeight: '600',
  },
  fetchBtn: {
    backgroundColor: COLORS.info,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    alignItems: 'center',
  },
  fetchBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: FONT_SIZE.md,
  },
  barContainer: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginVertical: SPACING.sm,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  barLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
    width: 50,
  },
  barTrack: {
    flex: 1,
    height: 16,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.sm,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: BORDER_RADIUS.sm,
  },
  copyBtn: {
    backgroundColor: COLORS.surfaceLight,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  copyBtnText: {
    color: COLORS.text,
    fontWeight: '600',
  },
});
