import React, { useState, useMemo, useRef, useEffect } from 'react';
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
import { calculateMarketplaceProfit, MarketplaceStrategy, breakEvenSellPrice } from '../lib/calculations';
import { Language } from '../lib/i18n';
import { fetchCurrentPrices, fetchCurrentPricesBatch, CITIES, City, Server, formatDataAge, PriceData, Quality } from '../lib/api';
import { parseUserNumber } from '../lib/numberParsing';
import { trackMarketCalculation, trackPriceFetch } from '../lib/analytics';
import { AlbionItem } from '../lib/items';
import NumberInput from '../components/NumberInput';
import PremiumToggle from '../components/PremiumToggle';
import ResultCard from '../components/ResultCard';
import PremiumInfoPanel from '../components/PremiumInfoPanel';
import ItemPicker from '../components/ItemPicker';
import QualitySelector from '../components/QualitySelector';
import { useWatchlist } from '../hooks/useWatchlist';

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
  const [useBuyOrder, setUseBuyOrder] = useState(true);
  const [useSellOrder, setUseSellOrder] = useState(true);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedCity, setSelectedCity] = useState<City>('Caerleon');
  const [priceDate, setPriceDate] = useState<{ sell: string; buy: string } | null>(null);
  const [quality, setQuality] = useState<Quality>(1);
  const { entries: watchlist, loaded: watchlistLoaded, add: addWatch, remove: removeWatch } = useWatchlist(server);
  const [watchResults, setWatchResults] = useState<PriceData[]>([]);
  const [watchLoading, setWatchLoading] = useState(false);
  const requestGeneration = useRef(0);
  useEffect(() => {
    requestGeneration.current += 1;
    setBuyPrice(''); setSellPrice(''); setPriceDate(null);
  }, [server, selectedCity]);
  const result = useMemo(() => {
    const buyParsed = parseUserNumber(buyPrice, false, lang);
    const sellParsed = parseUserNumber(sellPrice, false, lang);
    const quantityParsed = parseUserNumber(quantity, true, lang);
    const buy = buyParsed.valid ? buyParsed.value : 0;
    const sell = sellParsed.valid ? sellParsed.value : 0;
    const qty = quantityParsed.valid ? quantityParsed.value : 0;
    if (buy <= 0 || sell <= 0 || qty <= 0) return null;
    return calculateMarketplaceProfit(buy, sell, qty, isPremium, useBuyOrder, useSellOrder);
  }, [buyPrice, sellPrice, quantity, isPremium, useBuyOrder, useSellOrder, lang]);

  const comparisonRows = useMemo(() => {
    if (!result) return [];
    const buy = parseUserNumber(buyPrice, false, lang).value;
    const sell = parseUserNumber(sellPrice, false, lang).value;
    const qty = parseUserNumber(quantity, true, lang).value;
    const modes: MarketplaceStrategy[] = ['instant-instant', 'order-instant', 'instant-order', 'order-order'];
    return modes.map((mode) => {
      const flags = { useBuyOrder: mode === 'order-instant' || mode === 'order-order', useSellOrder: mode === 'instant-order' || mode === 'order-order' };
      const value = calculateMarketplaceProfit(buy, sell, qty, isPremium, flags.useBuyOrder, flags.useSellOrder);
      return { mode, value, breakEven: breakEvenSellPrice(buy, qty, isPremium, mode) };
    });
  }, [result, buyPrice, sellPrice, quantity, isPremium, lang]);

  const handleFetchPrices = async (item: AlbionItem) => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    try {
      const prices = await fetchCurrentPrices(item.id, [selectedCity], server, quality);
      if (generation !== requestGeneration.current) { setLoading(false); return; }
      const cityPrice = prices.find((p) => p.city === selectedCity && p.quality === quality);
      if (cityPrice) {
        addWatch({ itemId: item.id, itemName: item.n, quality });
        setBuyPrice(cityPrice.buy_price_max > 0 ? String(cityPrice.buy_price_max) : '');
        setSellPrice(cityPrice.sell_price_min > 0 ? String(cityPrice.sell_price_min) : '');
        trackPriceFetch(item.id, selectedCity);
        trackMarketCalculation();
        setPriceDate({
          sell: cityPrice.sell_price_min_date || '',
          buy: cityPrice.buy_price_max_date || '',
        });
      } else {
        Alert.alert(t('error'), t('noData'));
      }
    } catch (e) {
      Alert.alert(t('error'), String(e));
    }
    setLoading(false);
  };

  const scanWatchlist = async () => {
    if (!watchlist.length) return;
    setWatchLoading(true);
    try {
      const grouped = new Map<Quality, string[]>();
      for (const entry of watchlist) grouped.set(entry.quality, [...(grouped.get(entry.quality) || []), entry.itemId]);
      const partial: PriceData[] = [];
      for (const [entryQuality, ids] of grouped) {
        try { partial.push(...await fetchCurrentPricesBatch(ids, [...CITIES], server, entryQuality)); setWatchResults([...partial]); }
        catch { /* preserve successful batches and continue */ }
      }
    } finally { setWatchLoading(false); }
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

      <View style={styles.watchCard}>
        <View style={styles.watchHeader}>
          <Text style={styles.watchTitle}>{lang === 'fr' ? 'Favoris' : lang === 'es' ? 'Favoritos' : 'Watchlist'} ({watchlistLoaded ? watchlist.length : '…'})</Text>
          <TouchableOpacity style={styles.watchScanBtn} onPress={scanWatchlist} disabled={watchLoading || !watchlist.length}><Text style={styles.watchScanText}>{watchLoading ? '…' : lang === 'fr' ? 'Scanner' : 'Scan'}</Text></TouchableOpacity>
        </View>
        {watchlist.length === 0 ? <Text style={styles.watchEmpty}>{lang === 'fr' ? 'Sélectionne un item pour l’ajouter automatiquement.' : 'Select an item to add it automatically.'}</Text> : watchlist.map((entry) => {
          const count = watchResults.filter((p) => p.item_id === entry.itemId && p.quality === entry.quality).length;
          return <View style={styles.watchRow} key={`${entry.itemId}:${entry.quality}`}><Text style={styles.watchName} numberOfLines={1}>{entry.itemName} · Q{entry.quality}</Text><Text style={styles.watchCount}>{count ? `${count} villes` : '—'}</Text><TouchableOpacity onPress={() => removeWatch(entry)} style={styles.watchRemove}><Text style={styles.watchRemoveText}>×</Text></TouchableOpacity></View>;
        })}
      </View>

      {/* Premium Toggle */}
      <PremiumToggle
        isPremium={isPremium}
        onToggle={onPremiumChange}
        labelOn={t('premium')}
        labelOff={t('nonPremium')}
      />

      <QualitySelector value={quality} lang={lang} onChange={(nextQuality) => {
        setQuality(nextQuality);
        setBuyPrice(''); setSellPrice(''); setPriceDate(null);
      }} />

      {/* Buy and sell orders are independent decisions. */}
      <View style={styles.orderToggle}>
        <TouchableOpacity
          style={[styles.orderBtn, useBuyOrder && styles.orderBtnActive]}
          onPress={() => setUseBuyOrder((value) => !value)}
        >
          <Text style={[styles.orderBtnText, useBuyOrder && styles.orderBtnTextActive]}>
            {t('useBuyOrder')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.orderBtn, useSellOrder && styles.orderBtnActive]}
          onPress={() => setUseSellOrder((value) => !value)}
        >
          <Text style={[styles.orderBtnText, useSellOrder && styles.orderBtnTextActive]}>
            {t('useSellOrder')}
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
        locale={lang}
        label={t('buyPrice')}
        value={buyPrice}
        onChangeText={setBuyPrice}
        info={useBuyOrder ? t('setupFeeInfo') : undefined}
      />
      <NumberInput
        locale={lang}
        label={t('sellPrice')}
        value={sellPrice}
        onChangeText={setSellPrice}
        info={t('salesTaxInfo')}
      />
      <NumberInput
        locale={lang}
        label={t('quantity')}
        value={quantity}
        onChangeText={setQuantity}
        integer
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
                ? [
                    { label: t('setupFeeBuy'), value: `${result.setupFeeBuy} silver` },
                  ]
                : []),
              ...(useSellOrder
                ? [
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

      {comparisonRows.length > 0 && (
        <View style={styles.compareCard}>
          <Text style={styles.compareTitle}>{lang === 'fr' ? 'Comparer les stratégies' : lang === 'es' ? 'Comparar estrategias' : 'Compare strategies'}</Text>
          {comparisonRows.map(({ mode, value, breakEven }) => <View style={styles.compareRow} key={mode}><Text style={styles.compareMode}>{mode.replace('-', ' → ')}</Text><Text style={[styles.compareProfit, { color: value.profitPerItem >= 0 ? COLORS.profit : COLORS.loss }]}>{Math.round(value.profitPerItem).toLocaleString()} /u</Text><Text style={styles.compareBreakEven}>BE {breakEven.toLocaleString()}</Text></View>)}
          <Text style={styles.compareHint}>{lang === 'fr' ? 'BE = prix de vente minimal à l’équilibre. Les ordres ne garantissent pas l’exécution.' : 'BE = minimum break-even sale price. Orders do not guarantee execution.'}</Text>
        </View>
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
  watchCard: { backgroundColor: COLORS.card, borderRadius: BORDER_RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  watchHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  watchTitle: { color: COLORS.text, fontSize: FONT_SIZE.md, fontWeight: '700' },
  watchScanBtn: { minHeight: 44, paddingHorizontal: SPACING.md, justifyContent: 'center', borderRadius: BORDER_RADIUS.sm, backgroundColor: COLORS.primary },
  watchScanText: { color: COLORS.background, fontWeight: '800' },
  watchEmpty: { color: COLORS.textMuted, fontSize: FONT_SIZE.sm },
  watchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.border + '60' },
  watchName: { flex: 1, color: COLORS.textSecondary, fontSize: FONT_SIZE.sm },
  watchCount: { color: COLORS.textMuted, fontSize: FONT_SIZE.xs, marginHorizontal: SPACING.sm },
  watchRemove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  watchRemoveText: { color: COLORS.loss, fontSize: FONT_SIZE.xl },
  compareCard: { backgroundColor: COLORS.card, borderRadius: BORDER_RADIUS.md, padding: SPACING.md, marginVertical: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
  compareTitle: { color: COLORS.primary, fontSize: FONT_SIZE.md, fontWeight: '800', marginBottom: SPACING.sm },
  compareRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.border + '60' },
  compareMode: { flex: 1, color: COLORS.textSecondary, fontSize: FONT_SIZE.xs },
  compareProfit: { width: 90, textAlign: 'right', fontWeight: '800', fontSize: FONT_SIZE.sm },
  compareBreakEven: { width: 90, textAlign: 'right', color: COLORS.textMuted, fontSize: FONT_SIZE.xs },
  compareHint: { color: COLORS.textMuted, fontSize: FONT_SIZE.xs, marginTop: SPACING.sm },
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
