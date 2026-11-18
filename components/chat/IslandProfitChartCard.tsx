import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { COLORS } from '../../constants/theme';
import type { Language } from '../../lib/i18n';
import { parseIslandProfitChart, profitAxisRange, profitDayAtX, profitGesture, profitRuns, type IslandProfitSeries, type ProfitAxisRange, type ProfitScale } from '../../lib/islandProfitChart';
import { useChatTextScale } from './reading';

const COLORS_BY_SERIES = ['#913D31', '#176687', '#296442', '#705281', '#975014', '#9C3872', '#79600B', '#1A5976', '#623B65', '#325D5A', '#8B3535', '#504D81', '#785200', '#0D6A74', '#6C4B3B'];
const DAY = 86_400_000;
const PAGE_SIZE = 5;
const NAMES: Record<string, { fr: string; es: string }> = {
  T1_CARROT: { fr: 'Carotte', es: 'Zanahoria' }, T2_BEAN: { fr: 'Haricot', es: 'Frijol' },
  T3_WHEAT: { fr: 'Blé', es: 'Trigo' }, T4_TURNIP: { fr: 'Navet', es: 'Nabo' },
  T5_CABBAGE: { fr: 'Chou', es: 'Col' }, T6_POTATO: { fr: 'Pomme de terre', es: 'Patata' },
  T7_CORN: { fr: 'Maïs', es: 'Maíz' }, T8_PUMPKIN: { fr: 'Citrouille', es: 'Calabaza' },
};

type PlotSeries = { row: IslandProfitSeries; color: string };
function cropName(row: IslandProfitSeries, lang: Language): string {
  const local = NAMES[row.id];
  const name = local && lang !== 'en' ? local[lang] : row.name;
  const tier = /^T([1-8])_/.exec(row.id)?.[1];
  return tier ? `${name} · T${tier}` : name;
}
function dateLabel(start: number, day: number): string {
  return new Date(start + day * DAY).toISOString().slice(0, 10);
}
function compactMoney(value: number, locale: string): string {
  const abs = Math.abs(value);
  const unit = abs >= 1e9 ? 1e9 : abs >= 1e6 ? 1e6 : abs >= 1e3 ? 1e3 : 1;
  const suffix = unit === 1e9 ? ' Md' : unit === 1e6 ? ' M' : unit === 1e3 ? ' k' : '';
  return (value / unit).toLocaleString(locale, { maximumFractionDigits: unit === 1 ? 0 : 1 }) + suffix;
}

function ProfitPlot({ series, start, days, width, height, range, selectedDay, onSelectDay, lang, compact, textScale }: {
  series: PlotSeries[]; start: number; days: number; width: number; height: number; range: ProfitAxisRange;
  selectedDay: number; onSelectDay: (day: number) => void; lang: Language; compact?: boolean; textScale: number;
}) {
  const clipId = `profit-plot-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const locale = lang === 'fr' ? 'fr-FR' : lang === 'es' ? 'es-ES' : 'en-US';
  const left = 57, right = Math.max(left + 90, width - 12), top = 12, bottom = height - 31;
  const x = (day: number) => left + day / Math.max(1, days - 1) * (right - left);
  const y = (value: number) => top + (range.high - value) / (range.high - range.low) * (bottom - top);
  const pick = (event: GestureResponderEvent) => onSelectDay(profitDayAtX(event.nativeEvent.locationX, left, right, days));
  const gesture = useRef<{ x: number; y: number; intent: 'tap' | 'horizontal' | 'vertical' } | null>(null);
  const gridCount = compact ? 2 : 4;
  const label = lang === 'fr' ? 'Graphique du profit estimé par date' : lang === 'es' ? 'Beneficio estimado por fecha' : 'Estimated profit by date';

  return <View accessible accessibilityRole="adjustable" accessibilityLabel={label}
    accessibilityValue={{ text: dateLabel(start, selectedDay) + ' UTC' }}
    accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
    onAccessibilityAction={(event) => onSelectDay(Math.max(0, Math.min(days - 1, selectedDay + (event.nativeEvent.actionName === 'increment' ? 1 : -1))))}>
    <Svg width={width} height={height}>
      <Defs><ClipPath id={clipId}><Rect x={left} y={top} width={right - left} height={bottom - top} /></ClipPath></Defs>
      {Array.from({ length: gridCount }, (_, index) => {
        const value = range.high - (range.high - range.low) * index / (gridCount - 1);
        const yy = y(value);
        return <React.Fragment key={index}>
          <Line x1={left} x2={right} y1={yy} y2={yy} stroke={COLORS.border} strokeWidth={0.7} />
          <SvgText x={left - 6} y={yy + 3} textAnchor="end" fill={COLORS.textSecondary} fontSize={Math.min(11, 9 * textScale)}>{compactMoney(value, locale)}</SvgText>
        </React.Fragment>;
      })}
      {range.low <= 0 && range.high >= 0 && <Line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke={COLORS.borderStrong} strokeDasharray="4 3" strokeWidth={1} />}
      <G clipPath={`url(#${clipId})`}>
        {series.map(({ row, color }) => {
          const runs = profitRuns(row.points);
          const path = runs.filter((run) => run.length > 1).map((run) => run.map((point, index) => `${index ? 'L' : 'M'}${x(point.day).toFixed(1)},${y(point.profit).toFixed(1)}`).join(' ')).join(' ');
          return <G key={row.id}>
            {!!path && <Path d={path} fill="none" stroke={color} strokeWidth={compact ? 1.8 : 2.3} strokeLinejoin="round" strokeLinecap="round" />}
            {runs.filter((run) => run.length === 1).map((run) => <Circle key={`single-${run[0].day}`} cx={x(run[0].day)} cy={y(run[0].profit)} r={2.3} fill={color} />)}
            {row.points.filter((point) => point.day === selectedDay && point.profit >= range.low && point.profit <= range.high).map((point) => <Circle key={`selected-${point.day}`} cx={x(point.day)} cy={y(point.profit)} r={4} fill={color} stroke={COLORS.backgroundElevated} strokeWidth={1.5} />)}
          </G>;
        })}
        <Line x1={x(selectedDay)} x2={x(selectedDay)} y1={top} y2={bottom} stroke={COLORS.textSecondary} strokeDasharray="3 4" strokeWidth={0.9} />
      </G>
      {series.map(({ row, color }, seriesIndex) => row.points.filter((point) => point.profit < range.low || point.profit > range.high).map((point) => {
        const px = Math.max(left + 4, Math.min(right - 4, x(point.day) + (seriesIndex - (series.length - 1) / 2) * 3));
        const upper = point.profit > range.high;
        const edge = upper ? top : bottom;
        const inward = upper ? 6 : -6;
        return <Polygon key={`${row.id}-${point.day}`} points={`${px},${edge} ${px - 4},${edge + inward} ${px + 4},${edge + inward}`} fill={color} />;
      }))}
      <Rect x={left} y={top} width={right - left} height={bottom - top} fill={COLORS.text} opacity={0.001}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(event) => { gesture.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, intent: 'tap' }; }}
        onResponderMove={(event) => { const touch = gesture.current; if (!touch) return; const direction = profitGesture(event.nativeEvent.pageX - touch.x, event.nativeEvent.pageY - touch.y); if (touch.intent === 'tap' && direction !== 'tap') touch.intent = direction; if (touch.intent === 'horizontal') pick(event); }}
        onResponderRelease={(event) => { if (gesture.current && gesture.current.intent !== 'vertical') pick(event); gesture.current = null; }}
        onResponderTerminate={() => { gesture.current = null; }} onResponderTerminationRequest={() => true} />
      <SvgText x={left} y={height - 7} fill={COLORS.textSecondary} fontSize={Math.min(11, 9 * textScale)}>{dateLabel(start, 0)}</SvgText>
      <SvgText x={right} y={height - 7} textAnchor="end" fill={COLORS.textSecondary} fontSize={Math.min(11, 9 * textScale)}>{dateLabel(start, days - 1)}</SvgText>
    </Svg>
  </View>;
}

function IslandProfitChartCard({ name, result, lang }: { name: string; result?: string; lang: Language }) {
  const state = useMemo(() => parseIslandProfitChart(name, result), [name, result]);
  const textScale = useChatTextScale();
  const [mode, setMode] = useState<'comparison' | 'history'>('comparison');
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedDay, setSelectedDay] = useState(0);
  const [scale, setScale] = useState<ProfitScale>('full');
  const [showPicker, setShowPicker] = useState(false);
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(280);
  const tr = (fr: string, en: string, es: string) => lang === 'fr' ? fr : lang === 'es' ? es : en;
  const locale = lang === 'fr' ? 'fr-FR' : lang === 'es' ? 'es-ES' : 'en-US';
  const money = (value: number) => Math.round(value).toLocaleString(locale);
  const font = (size: number, height = size * 1.4) => ({ fontSize: size * textScale, lineHeight: height * textScale });

  useEffect(() => {
    if (state?.kind === 'ready') {
      setSelected(state.chart.series.filter((row) => row.points.length).slice(0, 3).map((row) => row.id));
      setSelectedDay(state.chart.days - 1);
    } else setSelected([]);
    setMode('comparison'); setScale('full'); setShowPicker(false); setPage(0);
  }, [state]);

  if (!state) return null;
  if (state.kind === 'unavailable') return <View style={styles.card}><Text style={[styles.title, font(17)]}>{tr('Graphique de rentabilité', 'Profitability chart', 'Gráfico de rentabilidad')}</Text><Text style={[styles.caption, font(12)]}>{tr('Pas assez de données pour tracer le graphique.', 'Not enough data to draw the chart.', 'No hay suficientes datos para dibujar el gráfico.')}</Text></View>;
  const chart = state.chart;
  const available = chart.series.filter((row) => row.points.length > 0);
  const visible = available.filter((row) => selected.includes(row.id));
  const multiple = visible.length > 4;
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const plotted = multiple ? visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE) : visible;
  const allPoints = visible.flatMap((row) => row.points);
  const range = profitAxisRange(allPoints, scale);
  const zoomPreview = profitAxisRange(allPoints, 'zoom');
  const colorFor = (id: string) => COLORS_BY_SERIES[Math.max(0, chart.series.findIndex((row) => row.id === id)) % COLORS_BY_SERIES.length];
  const ranked = chart.series.filter((row) => row.averageProfit !== null);
  const missing = chart.series.filter((row) => row.averageProfit === null);
  const positiveMax = Math.max(0, ...ranked.map((row) => row.averageProfit!));
  const negativeMax = Math.max(0, ...ranked.map((row) => -row.averageProfit!));
  const barSpan = Math.max(1, positiveMax + negativeMax);
  const zero = negativeMax / barSpan * 100;
  const toggle = (id: string) => { setSelected((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]); setPage(0); };
  const firstThree = () => { setSelected(available.slice(0, 3).map((row) => row.id)); setPage(0); };
  const selectAll = () => { setSelected(available.map((row) => row.id)); setPage(0); };
  const chartSeries = (rows: IslandProfitSeries[]) => rows.map((row) => ({ row, color: colorFor(row.id) }));
  const coverage = (row: IslandProfitSeries) => `${row.points.length}/${chart.days} ${tr('jours avec estimation', 'days with estimates', 'días con estimación')}`;

  return <View style={styles.card} testID="island-profit-chart">
    <View style={styles.heading}>
      <Text style={[styles.title, font(18, 23)]}>{tr('Rentabilité des cultures', 'Crop profitability', 'Rentabilidad de cultivos')}</Text>
      <Text style={[styles.subtitle, font(12, 17)]}>{chart.plots} {tr('terrains', 'plots', 'terrenos')} · {chart.marketCity} · {chart.days} {tr('jours', 'days', 'días')}</Text>
      <Text style={[styles.caption, font(12, 17)]}>{tr('Île', 'Island', 'Isla')} : {chart.islandCity} · {chart.premium ? 'Premium' : tr('Sans Premium', 'No Premium', 'Sin Premium')} · Focus : {money(chart.focus)}</Text>
    </View>
    <View style={styles.tabs}>
      <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === 'comparison' }} onPress={() => setMode('comparison')} style={[styles.tab, mode === 'comparison' && styles.tabActive]}><Text style={[styles.tabText, font(13)]}>{tr('Classement', 'Ranking', 'Clasificación')}</Text></Pressable>
      <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === 'history' }} onPress={() => setMode('history')} style={[styles.tab, mode === 'history' && styles.tabActive]}><Text style={[styles.tabText, font(13)]}>{tr('Historique', 'History', 'Historial')}</Text></Pressable>
    </View>
    {chart.partial && <Text style={[styles.warning, font(12)]}>{tr('Certaines cultures n’ont pas assez de données.', 'Some crops lack enough data.', 'Algunos cultivos no tienen suficientes datos.')}</Text>}
    {mode === 'comparison' ? <>
      <View style={styles.sectionHeader}>
        <View style={styles.flex}><Text style={[styles.sectionTitle, font(14)]}>{tr('Profit estimé par récolte', 'Estimated profit per harvest', 'Beneficio estimado por cosecha')}</Text><Text style={[styles.caption, font(11, 16)]}>{tr('Moyenne pondérée sur la période', 'Weighted average for the period', 'Media ponderada del período')}</Text></View>
        <Text style={[styles.countBadge, font(11)]}>{chart.series.length} {tr('cultures', 'crops', 'cultivos')}</Text>
      </View>
      <Text style={[styles.caption, font(11, 16)]}>{tr('Sélectionne les cultures à comparer dans l’historique.', 'Select crops to compare in history.', 'Selecciona cultivos para comparar en el historial.')}</Text>
      <ScrollView nestedScrollEnabled style={styles.ranking} contentContainerStyle={styles.rankingContent}>
        {ranked.map((row, index) => {
          const value = row.averageProfit!;
          const barWidth = Math.abs(value) / barSpan * 100;
          const barLeft = value < 0 ? zero - barWidth : zero;
          const checked = selected.includes(row.id);
          return <Pressable key={row.id} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: !row.points.length }}
            accessibilityLabel={`${cropName(row, lang)} · ${coverage(row)}`} disabled={!row.points.length} onPress={() => toggle(row.id)} style={styles.rankRow}>
            <View style={styles.rankHeader}><View style={styles.rankIdentity}><Text style={[styles.rankIndex, font(11)]}>{index + 1}</Text><Text style={[styles.rankName, font(13)]}>{cropName(row, lang)}</Text></View><Text style={[styles.rankValue, font(13)]}>{money(value)}</Text></View>
            <View style={styles.barTrack}><View style={[styles.bar, { left: `${barLeft}%`, width: `${barWidth}%`, backgroundColor: value < 0 ? COLORS.loss : colorFor(row.id) }]} /><View style={[styles.zero, { left: `${zero}%` }]} /></View>
            <View style={styles.rankFooter}><Text style={[styles.caption, font(11, 16)]}>{coverage(row)}</Text><Text style={[checked ? styles.selectedText : styles.link, font(11, 16)]}>{!row.points.length ? tr('Historique indisponible', 'History unavailable', 'Historial no disponible') : checked ? tr('✓ Sélectionnée', '✓ Selected', '✓ Seleccionado') : tr('+ Sélectionner', '+ Select', '+ Seleccionar')}</Text></View>
          </Pressable>;
        })}
        {missing.map((row) => <Text style={[styles.caption, font(12)]} key={row.id}>{cropName(row, lang)} · {tr('données insuffisantes', 'insufficient data', 'datos insuficientes')}</Text>)}
      </ScrollView>
      <Text style={[styles.caption, font(11, 16)]}>{tr('Fais défiler la liste pour voir toutes les cultures. Montants en argent.', 'Scroll to see every crop. Values in silver.', 'Desplázate para ver todos los cultivos. Valores en plata.')}</Text>
      <Pressable accessibilityRole="button" onPress={() => setMode('history')} style={styles.primaryButton}><Text style={[styles.primaryButtonText, font(13)]}>{tr('Voir l’historique', 'View history', 'Ver historial')} · {visible.length}</Text></Pressable>
    </> : <>
      <View style={styles.selectionSummary}><View style={styles.flex}><Text style={[styles.sectionTitle, font(14)]}>{visible.length}/{available.length} {tr('cultures sélectionnées', 'crops selected', 'cultivos seleccionados')}</Text><Text style={[styles.caption, font(11, 16)]} numberOfLines={2}>{visible.length ? visible.map((row) => cropName(row, lang)).join(' · ') : tr('Choisis une culture pour afficher sa courbe.', 'Select a crop to show its line.', 'Elige un cultivo para mostrar su línea.')}</Text></View>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showPicker }} onPress={() => setShowPicker(!showPicker)} style={styles.smallButton}><Text style={[styles.link, font(12)]}>{showPicker ? tr('Fermer', 'Close', 'Cerrar') : tr('Choisir', 'Choose', 'Elegir')}</Text></Pressable></View>
      {showPicker && <View style={styles.picker}>
        <View style={styles.pickerActions}><Pressable accessibilityRole="button" onPress={firstThree} style={styles.pickerAction}><Text style={[styles.link, font(12)]}>{tr('3 premières', 'Top 3', '3 primeros')}</Text></Pressable><Pressable accessibilityRole="button" onPress={selectAll} style={styles.pickerAction}><Text style={[styles.link, font(12)]}>{tr('Toutes', 'All', 'Todos')}</Text></Pressable></View>
        <ScrollView nestedScrollEnabled style={styles.pickerList}>{available.map((row) => <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(row.id) }} accessibilityLabel={cropName(row, lang)} key={row.id} onPress={() => toggle(row.id)} style={styles.pickerRow}><View style={[styles.swatch, { backgroundColor: colorFor(row.id) }]} /><Text style={[styles.rankName, styles.flex, font(12)]}>{cropName(row, lang)}</Text><Text style={[styles.link, font(13)]}>{selected.includes(row.id) ? '✓' : '+'}</Text></Pressable>)}</ScrollView>
      </View>}
      {visible.length > 0 && <>
        <View style={styles.scaleHeader}><Text style={[styles.caption, styles.flex, font(11, 16)]}>{tr('Argent par récolte', 'Silver per harvest', 'Plata por cosecha')}</Text><View style={styles.scaleButtons}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: scale === 'full' }} onPress={() => setScale('full')} style={[styles.scaleButton, scale === 'full' && styles.scaleButtonActive]}><Text style={[styles.scaleText, font(11)]}>{tr('Complet', 'Full', 'Completo')}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: scale === 'zoom' }} onPress={() => setScale('zoom')} style={[styles.scaleButton, scale === 'zoom' && styles.scaleButtonActive]}><Text style={[styles.scaleText, font(11)]}>Zoom</Text></Pressable>
        </View></View>
        {scale === 'zoom' && range.outside > 0 && <Text style={[styles.warning, font(11, 16)]}>{range.outside} {tr('valeurs hors échelle, indiquées aux bords. Leurs montants restent accessibles par date.', 'values outside the scale are marked at the edges. Their amounts remain available by date.', 'valores fuera de escala se marcan en los bordes. Sus importes siguen disponibles por fecha.')}</Text>}
        {scale === 'full' && zoomPreview.outside > 0 && <Text style={[styles.caption, font(11, 16)]}>{tr('Des pics compriment les variations : utilise Zoom pour les détailler.', 'Peaks compress the variations: use Zoom for detail.', 'Los picos comprimen las variaciones: usa Zoom para ver detalles.')}</Text>}
        <View onLayout={(event) => setWidth(Math.max(220, event.nativeEvent.layout.width))}>
          {multiple ? <>
            <View style={styles.sectionHeader}><Text style={[styles.caption, styles.flex, font(11, 16)]}>{tr('Courbes séparées · mêmes échelles', 'Separate lines · shared scales', 'Líneas separadas · mismas escalas')}</Text><Text style={[styles.caption, font(11, 16)]}>{currentPage + 1}/{pageCount}</Text></View>
            {plotted.map((row) => <View key={row.id} style={styles.smallChart}><View style={styles.smallChartHeading}><View style={[styles.swatch, { backgroundColor: colorFor(row.id) }]} /><Text style={[styles.rankName, styles.flex, font(12)]}>{cropName(row, lang)}</Text><Text style={[styles.caption, font(10)]}>{row.points.length}/{chart.days} j</Text></View><ProfitPlot series={chartSeries([row])} start={chart.start} days={chart.days} width={width - 16} height={130} range={range} selectedDay={selectedDay} onSelectDay={setSelectedDay} lang={lang} compact textScale={textScale}/></View>)}
            <View style={styles.pages}><Pressable accessibilityRole="button" accessibilityLabel={tr('Page précédente', 'Previous page', 'Página anterior')} disabled={currentPage === 0} onPress={() => setPage(currentPage - 1)} style={styles.pageButton}><Text style={[styles.link, currentPage === 0 && styles.disabledText, font(12)]}>{tr('‹ Précédent', '‹ Previous', '‹ Anterior')}</Text></Pressable><Text style={[styles.caption, font(11)]}>{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, visible.length)} / {visible.length}</Text><Pressable accessibilityRole="button" accessibilityLabel={tr('Page suivante', 'Next page', 'Página siguiente')} disabled={currentPage === pageCount - 1} onPress={() => setPage(currentPage + 1)} style={styles.pageButton}><Text style={[styles.link, currentPage === pageCount - 1 && styles.disabledText, font(12)]}>{tr('Suivant ›', 'Next ›', 'Siguiente ›')}</Text></Pressable></View>
          </> : <>
            <View style={styles.plotLegend}>{plotted.map((row) => <View key={row.id} style={styles.legendItem}><View style={[styles.swatch, { backgroundColor: colorFor(row.id) }]} /><Text style={[styles.caption, font(11, 16)]}>{cropName(row, lang)}</Text></View>)}</View>
            <ProfitPlot series={chartSeries(plotted)} start={chart.start} days={chart.days} width={width} height={220} range={range} selectedDay={selectedDay} onSelectDay={setSelectedDay} lang={lang} textScale={textScale}/>
          </>}
        </View>
        <Text style={[styles.caption, font(11, 16)]}>{tr('Appuie ou glisse sur une courbe pour choisir une date.', 'Tap or drag on a line to choose a date.', 'Toca o desliza en una línea para elegir una fecha.')}</Text>
        <View style={styles.dayDetails}><View style={styles.dayControls}>
          <Pressable accessibilityRole="button" accessibilityLabel={tr('Jour précédent', 'Previous day', 'Día anterior')} disabled={selectedDay <= 0} onPress={() => setSelectedDay(Math.max(0, selectedDay - 1))} style={styles.dayButton}><Text style={[styles.link, selectedDay <= 0 && styles.disabledText, font(18)]}>‹</Text></Pressable>
          <Text style={[styles.dayTitle, font(13)]}>{dateLabel(chart.start, selectedDay)} UTC</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={tr('Jour suivant', 'Next day', 'Día siguiente')} disabled={selectedDay >= chart.days - 1} onPress={() => setSelectedDay(Math.min(chart.days - 1, selectedDay + 1))} style={styles.dayButton}><Text style={[styles.link, selectedDay >= chart.days - 1 && styles.disabledText, font(18)]}>›</Text></Pressable>
        </View>{plotted.map((row) => { const point = row.points.find((value) => value.day === selectedDay); return <View key={row.id} style={styles.valueRow}><View style={[styles.swatch, { backgroundColor: colorFor(row.id) }]} /><Text style={[styles.caption, styles.flex, font(11, 16)]}>{cropName(row, lang)}</Text><Text style={[styles.valueText, font(11, 16)]}>{point ? `${money(point.profit)} ${tr('argent', 'silver', 'plata')}` : tr('aucune observation', 'no observation', 'sin observación')}</Text></View>; })}</View>
      </>}
    </>}
    <Text style={[styles.disclaimer, font(11, 16)]}>{tr('Estimations par récolte à partir des prix observés, des frais et du prix PNJ de référence des graines. Même scénario pour chaque jour : ce ne sont pas des gains encaissés. Les jours manquants restent vides. Construction et transport exclus.', 'Estimates per harvest use observed prices, fees and reference merchant seed prices. The same scenario is used each day: these are not realized profits. Missing days remain blank. Construction and transport are excluded.', 'Estimaciones por cosecha con precios observados, tasas y precios de referencia de semillas. Se usa el mismo escenario cada día: no son ganancias reales. Los días sin datos quedan vacíos. Se excluyen construcción y transporte.')}</Text>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLORS.backgroundElevated, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12, gap: 10, marginTop: 8 },
  heading: { gap: 2 }, title: { color: COLORS.text, fontWeight: '800' }, subtitle: { color: COLORS.primary, fontWeight: '700' },
  sectionTitle: { color: COLORS.text, fontWeight: '700' }, caption: { color: COLORS.textSecondary }, warning: { color: COLORS.warning }, disclaimer: { color: COLORS.textSecondary, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 9 },
  flex: { flex: 1 }, tabs: { flexDirection: 'row', backgroundColor: COLORS.surfaceLight, padding: 3, borderRadius: 7, gap: 3 },
  tab: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 5, paddingHorizontal: 8 }, tabActive: { backgroundColor: COLORS.backgroundElevated, borderWidth: 1, borderColor: COLORS.border }, tabText: { color: COLORS.text, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, countBadge: { color: COLORS.primary, backgroundColor: COLORS.primaryFaint, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3, overflow: 'hidden' },
  ranking: { maxHeight: 390 }, rankingContent: { gap: 7 }, rankRow: { backgroundColor: COLORS.surfaceLight, borderRadius: 7, padding: 9, gap: 5 },
  rankHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, rankIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 }, rankIndex: { color: COLORS.textSecondary, minWidth: 21, textAlign: 'center' }, rankName: { color: COLORS.text, fontWeight: '700', flexShrink: 1 }, rankValue: { color: COLORS.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  barTrack: { height: 7, backgroundColor: '#D9D2C5', borderRadius: 4, overflow: 'hidden', position: 'relative' }, bar: { height: 7, position: 'absolute', top: 0 }, zero: { position: 'absolute', top: 0, width: 1, height: 7, backgroundColor: COLORS.borderStrong },
  rankFooter: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, selectedText: { color: COLORS.profit, fontWeight: '700' }, link: { color: COLORS.primary, fontWeight: '700' },
  primaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: 6, padding: 8 }, primaryButtonText: { color: COLORS.onPrimary, fontWeight: '700' },
  selectionSummary: { flexDirection: 'row', alignItems: 'center', gap: 8 }, smallButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: COLORS.border, borderRadius: 5 },
  picker: { backgroundColor: COLORS.surfaceLight, borderRadius: 7, paddingHorizontal: 8 }, pickerActions: { flexDirection: 'row', justifyContent: 'space-between' }, pickerAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 5 }, pickerList: { maxHeight: 240 }, pickerRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: COLORS.border, paddingHorizontal: 4 },
  swatch: { width: 8, height: 8, borderRadius: 4 }, scaleHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, scaleButtons: { flexDirection: 'row', gap: 4 }, scaleButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 9, borderWidth: 1, borderColor: COLORS.border, borderRadius: 5 }, scaleButtonActive: { backgroundColor: COLORS.primarySoft, borderColor: COLORS.primary }, scaleText: { color: COLORS.text, fontWeight: '700' },
  plotLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 5 }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  smallChart: { backgroundColor: COLORS.surfaceLight, borderRadius: 7, marginTop: 7, padding: 8, gap: 2 }, smallChartHeading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pages: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, pageButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 3 },
  dayDetails: { backgroundColor: COLORS.surfaceLight, borderRadius: 7, paddingHorizontal: 8, paddingBottom: 8, gap: 4 }, dayControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, dayButton: { minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' }, dayTitle: { color: COLORS.text, fontWeight: '800' }, valueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 }, valueText: { color: COLORS.text, fontWeight: '700', flexShrink: 1, textAlign: 'right' }, disabledText: { opacity: 0.4 },
});

export default React.memo(IslandProfitChartCard);
