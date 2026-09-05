import React, { useState, useMemo, useRef } from 'react';
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
import { fetchCurrentPrices, CITIES, City, Server, formatDataAge, PriceData } from '../lib/api';
import { trackMarketCalculation, trackPriceFetch } from '../lib/analytics';
import { AlbionItem } from '../lib/items';
import { useRequestScope } from '../hooks/useScreenLifecycle';
import NumberInput from '../components/NumberInput';
import PremiumToggle from '../components/PremiumToggle';
import ResultCard from '../components/ResultCard';
import PremiumInfoPanel from '../components/PremiumInfoPanel';
import ItemPicker from '../components/ItemPicker';

interface Props {
  t: (key: any) => any;
  lang: Language;
  server: Server;
  isPremium: boolean;
  onPremiumChange: (value: boolean) => void;
}

export default function MarketplaceScreen({ t, lang, server, isPremium, onPremiumChange }: Props) {
  const [buyPrice, setBuyPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [useBuyOrder, setUseBuyOrder] = useState(false);
  const [useSellOrder, setUseSellOrder] = useState(false);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedCity, setSelectedCity] = useState<City>('Caerleon');
  const [priceDate, setPriceDate] = useState<{ sell: string; buy: string } | null>(null);
  const priceRequestGenerationRef = useRef(0);
  const requestScope = useRequestScope(`${server}:${selectedCity}:${useBuyOrder}:${useSellOrder}`);

  const result = useMemo(() => {
    const buy = parseFloat(buyPrice) || 0;
    const sell = parseFloat(sellPrice) || 0;
    const qty = parseInt(quantity) || 1;
    if (buy <= 0 && sell <= 0) return null;
    return calculateMarketplaceProfit(buy, sell, qty, isPremium, useBuyOrder, useSellOrder);
  }, [buyPrice, sellPrice, quantity, isPremium, useBuyOrder, useSellOrder]);

  const handleFetchPrices = async (item: AlbionItem) => {
    const scope = requestScope.begin();
    if (!scope) return;
    const generation = ++priceRequestGenerationRef.current;
    const requestedCity = selectedCity;
    const requestedBuyOrder = useBuyOrder;
    const requestedSellOrder = useSellOrder;
    setLoading(true);
    try {
      const prices = await fetchCurrentPrices(item.id, [requestedCity], server, 1, { signal: scope.signal, forceRefresh: true });
      if (!scope.current() || generation !== priceRequestGenerationRef.current) return;
      const cityPrice = prices.find((p) => p.city === requestedCity);
      if (cityPrice) {
        const fetchedBuyPrice = requestedBuyOrder
          ? cityPrice.buy_price_max
          : cityPrice.sell_price_min;
        const fetchedSellPrice = requestedSellOrder
          ? cityPrice.sell_price_min
          : cityPrice.buy_price_max;
        if (fetchedBuyPrice > 0) setBuyPrice(String(fetchedBuyPrice));
        if (fetchedSellPrice > 0) setSellPrice(String(fetchedSellPrice));
        trackPriceFetch(item.id, requestedCity);
        trackMarketCalculation();
        setPriceDate({
          buy: requestedBuyOrder ? cityPrice.buy_price_max_date : cityPrice.sell_price_min_date,
          sell: requestedSellOrder ? cityPrice.sell_price_min_date : cityPrice.buy_price_max_date,
        });
      } else {
        Alert.alert(t('error'), t('noData'));
      }
    } catch (e) {
      if (scope.current() && generation === priceRequestGenerationRef.current) Alert.alert(t('error'), String(e));
    }
    if (scope.current() && generation === priceRequestGenerationRef.current) setLoading(false);
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
        onToggle={onPremiumChange}
        labelOn={t('premium')}
        labelOff={t('nonPremium')}
      />

      {/* Buy and sell order choices are independent. */}
      <View style={styles.orderToggle}>
        <TouchableOpacity
          style={[styles.orderBtn, useBuyOrder && styles.orderBtnActive]}
          onPress={() => { priceRequestGenerationRef.current += 1; setLoading(false); setPriceDate(null); setBuyPrice(''); setSellPrice(''); setUseBuyOrder((value) => !value); }}
        >
          <Text style={[styles.orderBtnText, useBuyOrder && styles.orderBtnTextActive]}>
            {t('useBuyOrder')}: {useBuyOrder ? 'ON' : 'OFF'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.orderBtn, useSellOrder && styles.orderBtnActive]}
          onPress={() => { priceRequestGenerationRef.current += 1; setLoading(false); setPriceDate(null); setBuyPrice(''); setSellPrice(''); setUseSellOrder((value) => !value); }}
        >
          <Text style={[styles.orderBtnText, useSellOrder && styles.orderBtnTextActive]}>
            {t('useSellOrder')}: {useSellOrder ? 'ON' : 'OFF'}
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
                onPress={() => { priceRequestGenerationRef.current += 1; setLoading(false); setPriceDate(null); setBuyPrice(''); setSellPrice(''); setSelectedCity(city); }}
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

      {/* Price data timestamp */}
      {priceDate && (
        <View style={styles.dataAge}>
          {priceDate.sell ? (
            <Text style={styles.dataAgeText}>
              Sell: {formatDataAge(priceDate.sell, lang)}
            </Text>
          ) : null}
          {priceDate.buy ? (
            <Text style={styles.dataAgeText}>
              Buy: {formatDataAge(priceDate.buy, lang)}
            </Text>
          ) : null}
        </View>
      )}

      {/* Inputs */}
      <NumberInput
        label={t('buyPrice')}
        value={buyPrice}
        onChangeText={setBuyPrice}
        info={useBuyOrder ? t('setupFeeInfo') : t('directTrade')}
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
              ...(useBuyOrder
                ? [{ label: t('setupFeeBuy'), value: `${result.setupFeeBuy} silver` }]
                : []),
              ...(useSellOrder
                ? [{ label: t('setupFeeSell'), value: `${result.setupFeeSell} silver` }]
                : []),
              {
                label: t('upfrontInvestment'),
                value: `${result.upfrontInvestment} silver`,
              },
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
  dataAge: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.xs,
  },
  dataAgeText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
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
