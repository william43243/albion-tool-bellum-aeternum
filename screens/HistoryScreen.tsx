import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import Svg, { Circle as SvgCircle, Line as SvgLine, Polyline as SvgPolyline } from 'react-native-svg';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../constants/theme';
import {
  fetchPriceHistory,
  fetchCurrentPricesLiveBatch,
  CITIES,
  City,
  Server,
  HistoryResponse,
  formatDateForApi,
  daysAgo,
  formatDataAge,
  Quality,
} from '../lib/api';
import { AlbionItem } from '../lib/items';
import { Language } from '../lib/i18n';
import { createLiveTrackingController, LiveCadence, LIVE_INTERVALS } from '../lib/liveTrackingController';
import { LivePoint } from '../lib/liveTracking';
import { prepareHistoryChart } from '../lib/historyChart';
import { parseAodpTimestamp } from '../lib/aodpTime';
import ItemPicker from '../components/ItemPicker';
import QualitySelector from '../components/QualitySelector';

interface Props {
  t: (key: any) => any;
  lang: Language;
  server: Server;
}

const PERIODS = [
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
  { key: '1y', days: 365 },
] as const;

// Very distinct colors per city — high contrast on dark bg
const CITY_COLORS: Record<string, string> = {
  Caerleon: '#FF4444',
  Bridgewatch: '#FF9F1C',
  'Fort Sterling': '#00D4FF',
  Lymhurst: '#44FF44',
  Thetford: '#C77DFF',
  Martlock: '#FFE03D',
  Brecilien: '#FF66B2',
};

const screenWidth = Dimensions.get('window').width - SPACING.lg * 2;

function formatSilver(value: number): string {
  if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
  if (value >= 1000) return (value / 1000).toFixed(1) + 'k';
  return Math.round(value).toLocaleString();
}

export default function HistoryScreen({ t, lang, server }: Props) {
  const [selectedItems, setSelectedItems] = useState<AlbionItem[]>([]);
  const [selectedCities, setSelectedCities] = useState<Set<City>>(new Set(['Caerleon']));
  const [period, setPeriod] = useState<number>(30);
  const [timeScale, setTimeScale] = useState<1 | 24>(24);
  const [quality, setQuality] = useState<Quality>(1);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [liveCadence, setLiveCadence] = useState<LiveCadence>('1m');
  const [livePoints, setLivePoints] = useState<LivePoint[]>([]);
  const [liveSeriesCount, setLiveSeriesCount] = useState(0);
  const [liveStatus, setLiveStatus] = useState<'waiting' | 'new-data' | 'no-new-data' | 'no-data' | 'error'>('waiting');
  const [livePollAt, setLivePollAt] = useState<number | undefined>();
  const [liveError, setLiveError] = useState<string | undefined>();
  const [liveSuspended, setLiveSuspended] = useState(false);
  const [liveDashedSegments, setLiveDashedSegments] = useState<import('../lib/liveChart').LiveChartSegment[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const liveController = useRef(createLiveTrackingController({
    fetchPrices: (config, signal) => fetchCurrentPricesLiveBatch(config.itemIds, config.cities, config.server, config.quality, { signal }),
    onUpdate: (snapshot) => { setLivePoints(snapshot.points); setLiveSeriesCount(snapshot.seriesCount); setLiveDashedSegments(snapshot.dashedSegments); setLiveStatus(snapshot.status); setLivePollAt(snapshot.lastPollAt); setLiveError(snapshot.error?.message); setLiveSuspended(snapshot.state === 'suspended'); },
  }));
  const liveConfigKey = `${selectedItems.map(i => i.id).join(',')}|${[...selectedCities].join(',')}|${server}|${quality}`;
  useEffect(() => () => liveController.current.stop(), []);
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    liveController.current.stop();
    setLiveEnabled(false);
    setLiveSuspended(false);
    setLivePoints([]);
    setLiveDashedSegments([]);
  }, [liveConfigKey]);
  const [historyData, setHistoryData] = useState<HistoryResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const requestGeneration = useRef(0);
  const historyConfigKey = `${liveConfigKey}|${period}|${timeScale}`;
  const historyConfigRef = useRef(historyConfigKey);
  historyConfigRef.current = historyConfigKey;
  useEffect(() => {
    // Invalidate completed and in-flight results whenever their inputs change.
    requestGeneration.current += 1;
    setHistoryData([]);
    setLoading(false);
    return () => { requestGeneration.current += 1; };
  }, [historyConfigKey]);

  const periodLabels: Record<string, string> = {
    '7d': t('days7'),
    '30d': t('days30'),
    '90d': t('days90'),
    '1y': t('year1'),
  };

  const toggleCity = (city: City) => {
    const newSet = new Set(selectedCities);
    if (newSet.has(city)) {
      if (newSet.size > 1) newSet.delete(city);
    } else {
      newSet.add(city);
    }
    setSelectedCities(newSet);
  };

  const fetchHistory = useCallback(async () => {
    if (selectedItems.length === 0) {
      Alert.alert(t('error'), t('selectItems'));
      return;
    }
    // Defensive: toggleCity already prevents removing the last city, but never
    // fire a request with an empty locations list.
    if (selectedCities.size === 0) {
      Alert.alert(t('error'), t('selectCities'));
      return;
    }
    setLoading(true);
    const generation = ++requestGeneration.current;
    const requestedConfig = historyConfigKey;
    const isCurrentRequest = () => generation === requestGeneration.current && requestedConfig === historyConfigRef.current;
    try {
      const startDate = formatDateForApi(daysAgo(period));
      const endDate = formatDateForApi(new Date());
      const cities = Array.from(selectedCities);

      const allData: HistoryResponse[] = [];
      for (const item of selectedItems) {
        const data = await fetchPriceHistory(item.id, cities, startDate, endDate, timeScale, server, quality);
        if (!isCurrentRequest()) return;
        allData.push(...data);
      }
      if (!isCurrentRequest()) return;
      setHistoryData(allData);
    } catch (e) {
      if (isCurrentRequest()) Alert.alert(t('error'), String(e));
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [selectedItems, selectedCities, period, timeScale, server, quality, historyConfigKey]);

  // Keep the presentation model testable without native rendering dependencies.
  const chartInfo = React.useMemo(() => prepareHistoryChart({
    historyData, livePoints, liveDashedSegments,
    multipleItems: selectedItems.length > 1,
    colors: CITY_COLORS,
    width: screenWidth - SPACING.md,
  }), [historyData, selectedItems, livePoints, liveDashedSegments]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('history')}</Text>
      <QualitySelector value={quality} lang={lang} onChange={(next) => { setQuality(next); setHistoryData([]); }} />

      {/* Item Selection */}
      <TouchableOpacity
        style={styles.selectBtn}
        onPress={() => setShowItemPicker(true)}
      >
        <Text style={styles.selectBtnText} numberOfLines={2}>
          {selectedItems.length > 0
            ? selectedItems.map((i) => i.n).join(', ')
            : t('selectItems')}
        </Text>
      </TouchableOpacity>

      {/* City Selection */}
      <Text style={styles.sectionLabel}>{t('selectCities')}</Text>
      <View style={styles.chips}>
        {CITIES.map((city) => {
          const isSelected = selectedCities.has(city);
          const color = CITY_COLORS[city] || COLORS.text;
          return (
            <TouchableOpacity
              key={city}
              style={[
                styles.chip,
                isSelected && { backgroundColor: color + '20', borderColor: color },
              ]}
              onPress={() => toggleCity(city)}
            >
              {isSelected && (
                <View style={[styles.chipDot, { backgroundColor: color }]} />
              )}
              <Text
                style={[styles.chipText, isSelected && { color, fontWeight: '700' }]}
              >
                {city}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Period + Scale */}
      <View style={styles.controlsRow}>
        <View style={styles.periodGroup}>
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[styles.periodBtn, period === p.days && styles.periodBtnActive]}
              onPress={() => setPeriod(p.days)}
            >
              <Text style={[styles.periodBtnText, period === p.days && styles.periodBtnTextActive]}>
                {periodLabels[p.key]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.scaleGroup}>
          <TouchableOpacity
            style={[styles.scaleBtn, timeScale === 24 && styles.scaleBtnActive]}
            onPress={() => setTimeScale(24)}
          >
            <Text style={[styles.scaleBtnText, timeScale === 24 && styles.scaleBtnTextActive]}>
              {t('daily')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.scaleBtn, timeScale === 1 && styles.scaleBtnActive]}
            onPress={() => setTimeScale(1)}
          >
            <Text style={[styles.scaleBtnText, timeScale === 1 && styles.scaleBtnTextActive]}>
              {t('hourly')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Live tracking control; existing selectors above remain unchanged. */}
      <View style={styles.liveRow}>
        <TouchableOpacity style={[styles.liveBtn, liveEnabled && styles.liveBtnActive]} onPress={() => {
          if (liveSuspended) { liveController.current.resume(); return; }
          if (liveEnabled) { liveController.current.stop(); setLiveEnabled(false); return; }
          if (!selectedItems.length || !selectedCities.size) { Alert.alert(t('error'), t('selectItems')); return; }
          setLiveEnabled(true); liveController.current.start({ itemIds: selectedItems.map(i => i.id), cities: Array.from(selectedCities), server, quality, cadence: liveCadence });
        }}>
          <Text style={styles.liveBtnText}>{liveSuspended ? t('resumeLiveTracking') : liveEnabled ? t('stopLiveTracking') : t('liveTracking')}</Text>
        </TouchableOpacity>
        <View style={styles.cadenceGroup}>{(['5s', '1m', '5m'] as LiveCadence[]).map((cadence) => (
          <TouchableOpacity key={cadence} style={[styles.cadenceBtn, liveCadence === cadence && styles.cadenceActive]} onPress={() => {
            setLiveCadence(cadence);
            if (liveEnabled && selectedItems.length && selectedCities.size) liveController.current.start({ itemIds: selectedItems.map(i => i.id), cities: Array.from(selectedCities), server, quality, cadence });
          }}><Text style={styles.cadenceText}>{cadence}</Text></TouchableOpacity>
        ))}</View>
      </View>
      {liveEnabled && <View><Text style={styles.liveStatus}>{t('liveTrackingOn')} · {liveStatus === 'new-data' ? t('newData') : liveStatus === 'no-new-data' ? t('noNewData') : liveStatus === 'no-data' ? t('liveNoData') : t('liveWaiting')} · {liveSeriesCount} {t('liveSeries')} · {livePollAt ? `${t('lastPoll')}: ${new Date(livePollAt).toLocaleTimeString()}` : ''}</Text>{liveError && <Text style={styles.liveError}>{liveSuspended ? t('rateLimitError') : `${t('liveRetrying')}: ${liveError}`}</Text>}</View>}

      {/* Fetch Button */}
      <TouchableOpacity
        style={styles.fetchBtn}
        onPress={fetchHistory}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color={COLORS.background} />
        ) : (
          <Text style={styles.fetchBtnText}>{t('compare')}</Text>
        )}
      </TouchableOpacity>

      {/* Chart + Legend + Stats — all in one card */}
      {chartInfo && (
        <View style={styles.chartCard}>
          {/* Chart title */}
          <Text style={styles.chartTitle}>
            {selectedItems.map((i) => i.n).join(' vs ')}
          </Text>
          <Text style={styles.chartSubtitle}>
            {t('averagePriceSilver')}
            {' • '}
            {periodLabels[PERIODS.find((p) => p.days === period)?.key || '30d']}
          </Text>
          {chartInfo.hasTruncatedSeries && (
            <Text style={styles.dataTimestamp}>
              {t('truncatedData')}
            </Text>
          )}

          {/* Show most recent data point timestamp */}
          {historyData.length > 0 && (() => {
            const allTimestamps = historyData
              .flatMap((h) => h.data.map((d) => d.timestamp))
              .filter(Boolean)
              .sort((a, b) => parseAodpTimestamp(b) - parseAodpTimestamp(a));
            const latest = allTimestamps[0];
            if (!latest) return null;
            return (
              <Text style={styles.dataTimestamp}>
                {t('latestData')}: {formatDataAge(latest, lang, nowMs)}
              </Text>
            );
          })()}

          {/* Chart */}
          {chartInfo.datasets.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ position: 'relative' }}>
            <LineChart
              data={{
                labels: chartInfo.labels,
                datasets: chartInfo.datasets,
              }}
              width={chartInfo.projection.width}
              height={220}
              chartConfig={{
                backgroundColor: 'transparent',
                backgroundGradientFrom: COLORS.card,
                backgroundGradientTo: COLORS.card,
                decimalPlaces: 0,
                color: (opacity = 1) => `rgba(200, 168, 78, ${opacity * 0.3})`,
                labelColor: () => COLORS.textSecondary,
                propsForDots: {
                  r: '4',
                  strokeWidth: '2',
                  stroke: COLORS.card,
                },
                propsForBackgroundLines: {
                  strokeDasharray: '4 4',
                  stroke: COLORS.border + '60',
                  strokeWidth: 1,
                },
                propsForLabels: {
                  fontSize: 11,
                  fontWeight: '600',
                },
                formatYLabel: (val: string) => formatSilver(Number(val)),
              }}
              withInnerLines
              withOuterLines={false}
              withVerticalLines={false}
              withHorizontalLabels
              withVerticalLabels
              withDots={false}
              withShadow={false}
              fromZero={false}
              bezier={false}
              style={styles.chart}
            />
            <Svg pointerEvents="none" width={chartInfo.projection.width} height={chartInfo.projection.height} style={{ position: 'absolute', left: 0, top: 0 }}>
              {chartInfo.lineSegments.map((segment, index) => <SvgPolyline key={`solid-${index}`} points={segment.points.map((point) => { const xy = chartInfo.projectPoint(point.timestamp, point.value); return `${xy.x},${xy.y}`; }).join(' ')} fill="none" stroke={segment.color} strokeWidth="3" />)}
              {chartInfo.isolatedPoints.map((point) => {
                const xy = chartInfo.projectPoint(point.timestamp, point.value);
                return <SvgCircle key={point.key + '|' + point.timestamp} cx={xy.x} cy={xy.y} r="4" fill={point.color} />;
              })}
              {liveDashedSegments.map((segment, index) => {
                const from = chartInfo.projectPoint(segment.from.timestamp, segment.from.value);
                const to = chartInfo.projectPoint(segment.to.timestamp, segment.to.value);
                return <SvgLine key={`dashed-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={CITY_COLORS[segment.city] || COLORS.primary} strokeWidth="3" strokeDasharray="8 5" />;
              })}
            </Svg>
          </View>
          </ScrollView>
          ) : (
            <Text style={styles.dataTimestamp}>
              {t('noCommonTimestamps')}
            </Text>
          )}

          {/* Legend — clear, one per line with color bar */}
          <View style={styles.legendContainer}>
            <Text style={styles.legendTitle}>
              {t('legend')}
            </Text>
            {chartInfo.legendEntries.map((entry, idx) => (
              <View key={idx} style={styles.legendRow}>
                <View style={[styles.legendColorBar, { backgroundColor: entry.color }]} />
                <Text style={[styles.legendLabel, { color: entry.color }]}>
                  {entry.label}
                </Text>
                <Text style={styles.legendLastPrice}>
                  {formatSilver(entry.last)}
                </Text>
              </View>
            ))}
          </View>

          {/* Stats table below chart */}
          <View style={styles.statsTable}>
            <View style={styles.statsHeader}>
              <Text style={[styles.statsHeaderCell, { flex: 2 }]}>
                {t('city')}
              </Text>
              <Text style={styles.statsHeaderCell}>Min</Text>
              <Text style={styles.statsHeaderCell}>{t('average')}</Text>
              <Text style={styles.statsHeaderCell}>Max</Text>
              <Text style={styles.statsHeaderCell}>
                {t('current')}
              </Text>
            </View>
            {chartInfo.legendEntries.map((entry, idx) => (
              <View key={idx} style={styles.statsRow}>
                <View style={[styles.statsCell, { flex: 2, flexDirection: 'row', alignItems: 'center' }]}>
                  <View style={[styles.statsDot, { backgroundColor: entry.color }]} />
                  <Text style={[styles.statsCellText, { color: entry.color }]} numberOfLines={1}>
                    {entry.label}
                  </Text>
                </View>
                <View style={styles.statsCell}>
                  <Text style={[styles.statsCellText, { color: COLORS.loss }]}>
                    {formatSilver(entry.min)}
                  </Text>
                </View>
                <View style={styles.statsCell}>
                  <Text style={[styles.statsCellText, { color: COLORS.primary }]}>
                    {entry.avg === null ? '—' : formatSilver(entry.avg)}
                  </Text>
                </View>
                <View style={styles.statsCell}>
                  <Text style={[styles.statsCellText, { color: COLORS.profit }]}>
                    {formatSilver(entry.max)}
                  </Text>
                </View>
                <View style={styles.statsCell}>
                  <Text style={[styles.statsCellText, { fontWeight: '700' }]}>
                    {formatSilver(entry.last)}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* Price trend indicator */}
          {chartInfo.legendEntries.length > 0 && (
            <View style={styles.trendContainer}>
              {chartInfo.legendEntries.map((entry, idx) => {
                if (entry.avg === null) return null;
                const trend = entry.last > entry.avg ? 'up' : entry.last < entry.avg ? 'down' : 'stable';
                const trendIcon = trend === 'up' ? '\u2191' : trend === 'down' ? '\u2193' : '\u2192';
                const trendColor = trend === 'up' ? COLORS.profit : trend === 'down' ? COLORS.loss : COLORS.textMuted;
                const pctDiff = entry.avg > 0 ? ((entry.last - entry.avg) / entry.avg * 100).toFixed(1) : '0';
                return (
                  <View key={idx} style={styles.trendRow}>
                    <View style={[styles.trendDot, { backgroundColor: entry.color }]} />
                    <Text style={styles.trendLabel}>{entry.label}</Text>
                    <Text style={[styles.trendValue, { color: trendColor }]}>
                      {trendIcon} {pctDiff}%
                    </Text>
                    <Text style={styles.trendCaption}>
                      {lang === 'fr' ? 'vs moyenne' : 'vs avg'}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      {!chartInfo && !loading && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>{'\u{1F4CA}'}</Text>
          <Text style={styles.emptyText}>
            {lang === 'fr'
              ? 'S\u00e9lectionne un item et des villes\npuis appuie sur "Comparer"'
              : 'Select an item and cities\nthen tap "Compare"'}
          </Text>
        </View>
      )}

      <ItemPicker
        visible={showItemPicker}
        onClose={() => setShowItemPicker(false)}
        onSelect={(item) => {
          setSelectedItems([item]);
          setShowItemPicker(false);
        }}
        lang={lang}
        multiSelect
        selectedIds={selectedItems.map((i) => i.id)}
        onMultiSelect={setSelectedItems}
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
    paddingBottom: SPACING.xxl * 3,
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
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.md,
  },
  selectBtnText: {
    color: COLORS.primary,
    fontWeight: '600',
    fontSize: FONT_SIZE.md,
  },
  sectionLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginBottom: SPACING.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.xs + 2,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.sm,
  },
  chipDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: SPACING.xs,
  },

  // Controls row: period + scale side by side
  controlsRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  periodGroup: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  periodBtn: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs + 1,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  periodBtnActive: {
    backgroundColor: COLORS.primary + '25',
    borderColor: COLORS.primary,
  },
  periodBtnText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
  },
  periodBtnTextActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  scaleGroup: {
    flexDirection: 'row',
    gap: 4,
  },
  scaleBtn: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs + 1,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  scaleBtnActive: {
    backgroundColor: COLORS.info + '20',
    borderColor: COLORS.info,
  },
  scaleBtnText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
  },
  scaleBtnTextActive: {
    color: COLORS.info,
    fontWeight: '700',
  },

  liveRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.xs },
  liveBtn: { flex: 1, paddingVertical: SPACING.sm, borderRadius: BORDER_RADIUS.sm, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.info },
  liveBtnActive: { backgroundColor: COLORS.info + '30' },
  liveBtnText: { color: COLORS.info, fontWeight: '700', textAlign: 'center', fontSize: FONT_SIZE.xs },
  cadenceGroup: { flexDirection: 'row', gap: 3 },
  cadenceBtn: { paddingHorizontal: SPACING.xs, paddingVertical: SPACING.sm, borderRadius: BORDER_RADIUS.sm, borderWidth: 1, borderColor: COLORS.border },
  cadenceActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '25' },
  cadenceText: { color: COLORS.textMuted, fontSize: FONT_SIZE.xs },
  liveStatus: { color: COLORS.textMuted, fontSize: FONT_SIZE.xs, marginBottom: SPACING.sm },
  liveError: { color: COLORS.loss, fontSize: FONT_SIZE.xs, marginBottom: SPACING.sm },

  fetchBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  fetchBtnText: {
    color: COLORS.background,
    fontWeight: '700',
    fontSize: FONT_SIZE.lg,
  },

  // Chart card
  chartCard: {
    backgroundColor: COLORS.card,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chartTitle: {
    color: COLORS.text,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    marginBottom: 2,
  },
  chartSubtitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginBottom: SPACING.md,
  },
  dataTimestamp: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    marginBottom: SPACING.sm,
    fontStyle: 'italic',
  },
  chart: {
    borderRadius: BORDER_RADIUS.md,
    marginLeft: -SPACING.sm,
  },

  // Legend
  legendContainer: {
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border + '60',
  },
  legendTitle: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.xs + 2,
  },
  legendColorBar: {
    width: 16,
    height: 4,
    borderRadius: 2,
    marginRight: SPACING.sm,
  },
  legendLabel: {
    flex: 1,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
  },
  legendLastPrice: {
    color: COLORS.text,
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
  },

  // Stats table
  statsTable: {
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border + '60',
  },
  statsHeader: {
    flexDirection: 'row',
    marginBottom: SPACING.xs,
    paddingBottom: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border + '40',
  },
  statsHeaderCell: {
    flex: 1,
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    paddingVertical: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border + '20',
  },
  statsCell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  statsCellText: {
    color: COLORS.text,
    fontSize: FONT_SIZE.xs,
    fontWeight: '500',
  },

  // Trend
  trendContainer: {
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border + '60',
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  trendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: SPACING.xs,
  },
  trendLabel: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: FONT_SIZE.sm,
  },
  trendValue: {
    fontSize: FONT_SIZE.md,
    fontWeight: '800',
    marginRight: SPACING.xs,
  },
  trendCaption: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
  },

  // Empty
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl * 2,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: SPACING.md,
    opacity: 0.4,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    textAlign: 'center',
    lineHeight: 22,
  },
});
