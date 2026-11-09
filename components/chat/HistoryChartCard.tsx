import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { parseHistoryChart, type HistoryObservation, type HistoryChartData } from '../../lib/chatHistoryChart';

const colors = ['#f6d787', '#6dc9e0', '#e89a79', '#a7d290', '#ca9ee7', '#f6afc5', '#a1b5c7'];
const DAY_MS = 86_400_000;

function formatQuantity(value: number): string {
  return Math.round(value).toLocaleString('fr-FR');
}

function compactQuantity(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)} k`;
  return `${Math.round(value)}`;
}

function VolumeMiniChart({
  series,
  color,
  startDay,
  dayCount,
  limit,
  width,
  commonMax,
  selected,
  onSelect,
}: {
  series: HistoryChartData['series'][number];
  color: string;
  startDay: number;
  dayCount: number;
  limit: number;
  width: number;
  commonMax?: number;
  selected: number | null;
  onSelect: (timestamp: number) => void;
}) {
  const points = series.points.filter((point) => point.timestamp <= limit);
  if (points.length === 0) return null;

  const localMax = Math.max(1, ...points.map((point) => point.itemCount));
  const maxCount = Math.max(1, commonMax ?? localMax);
  const plotWidth = Math.max(width - 48, 120);
  const top = 7;
  const bottom = 48;
  const slotWidth = plotWidth / Math.max(dayCount, 1);
  const barWidth = Math.max(1.5, Math.min(9, slotWidth * 0.68));
  const xFor = (timestamp: number) => 4 + ((timestamp - startDay) / DAY_MS + 0.5) * slotWidth;
  const yFor = (count: number) => bottom - (count / maxCount) * (bottom - top);
  const selectedInRange = selected !== null && selected >= startDay && selected < startDay + dayCount * DAY_MS;

  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color: '#a8babd', fontSize: 10 }}>
        {series.city} · 0–{formatQuantity(commonMax ?? localMax)} objets{commonMax ? ' (échelle commune)' : ' (échelle propre)'}
      </Text>
      <Svg width={width} height={58}>
        {[0, 0.5, 1].map((fraction) => {
          const y = bottom - fraction * (bottom - top);
          return <Line key={fraction} x1={4} x2={plotWidth} y1={y} y2={y} stroke="#293643" strokeWidth={0.7} />;
        })}
        {selectedInRange && <Line x1={xFor(selected!)} x2={xFor(selected!)} y1={top} y2={bottom} stroke="#fff1ce" strokeDasharray="3 2" strokeWidth={1} />}
        {points.map((point) => {
          const x = xFor(point.timestamp);
          const y = yFor(point.itemCount);
          return (
            <Rect
              key={`${series.city}-${point.timestamp}`}
              x={x - barWidth / 2}
              y={y}
              width={barWidth}
              height={Math.max(1, bottom - y)}
              fill={color}
              opacity={0.82}
              onPress={() => onSelect(point.timestamp)}
            />
          );
        })}
        <SvgText x={plotWidth + 4} y={top + 4} fill="#a5b4c3" fontSize={8}>{compactQuantity(maxCount)}</SvgText>
        <SvgText x={plotWidth + 4} y={bottom + 3} fill="#a5b4c3" fontSize={8}>0</SvgText>
        {Array.from({ length: dayCount }, (_, index) => {
          const timestamp = startDay + index * DAY_MS;
          return (
            <Rect
              key={`hit-${series.city}-${timestamp}`}
              x={4 + index * slotWidth}
              y={top}
              width={Math.max(slotWidth, 2)}
              height={bottom - top}
              fill="#ffffff"
              opacity={0.001}
              onPress={() => {
                if (series.points.some((point) => point.timestamp === timestamp && point.timestamp <= limit)) onSelect(timestamp);
              }}
            />
          );
        })}
      </Svg>
    </View>
  );
}

function HistoryChartCard({ name, result }: { name: string; result?: string }) {
  const chart = useMemo(() => parseHistoryChart(name, result), [name, result]);
  const times = useMemo(
    () => (chart ? [...new Set(chart.series.flatMap((series) => series.points.map((point) => point.timestamp)))].sort((a, b) => a - b) : []),
    [chart],
  );
  const [speed, setSpeed] = useState(1);
  const [timelineWidth, setTimelineWidth] = useState(1);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [replay, setReplay] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [full, setFull] = useState(false);
  const [separate, setSeparate] = useState(true);
  const [sharedScale, setSharedScale] = useState(false);
  const [width, setWidth] = useState(300);
  const [selected, setSelected] = useState<number | null>(null);

  const startDay = times.length ? Math.floor(times[0] / DAY_MS) * DAY_MS : 0;
  const dayCount = times.length ? Math.floor((times[times.length - 1] - startDay) / DAY_MS) + 1 : 0;

  useEffect(() => {
    if (!playing || !replay || dayCount < 2) return;
    const id = setInterval(() => setCursor((index) => Math.min(index + 1, dayCount - 1)), 1000 / speed);
    return () => clearInterval(id);
  }, [playing, replay, dayCount, speed]);

  useEffect(() => {
    if (playing && cursor >= dayCount - 1) setPlaying(false);
  }, [cursor, dayCount, playing]);

  if (!chart) return null;

  const visible = chart.series.filter((series) => !excluded.includes(series.city));
  const visiblePoints = visible.flatMap((series) => series.points);
  if (!visiblePoints.length) return null;

  const minT = times[0];
  const maxT = times[times.length - 1];
  const minP = Math.min(...visiblePoints.map((point) => point.price));
  const maxP = Math.max(...visiblePoints.map((point) => point.price));
  const maxItemCount = Math.max(...visiblePoints.map((point) => point.itemCount));
  const plotWidth = Math.max(width - 65, 100);
  const height = 260;
  const x = (timestamp: number) => 10 + ((timestamp - minT) / Math.max(1, maxT - minT)) * plotWidth;
  const y = (price: number, low: number, high: number) => 12 + ((high - price) / Math.max(1, high - low)) * (height - 42);
  const limit = replay ? startDay + (Math.min(cursor, dayCount - 1) + 1) * DAY_MS - 1 : Infinity;
  const selectDate = (timestamp: number) => {
    setPlaying(false);
    setSelected(timestamp);
    const index = Math.floor((timestamp - startDay) / DAY_MS);
    if (replay && index > cursor) setCursor(index);
  };
  const seek = (index: number) => {
    setPlaying(false);
    setSelected(null);
    setCursor(Math.max(0, Math.min(dayCount - 1, index)));
  };

  const content = (
    <View style={{ padding: 12, gap: 10, backgroundColor: '#101821' }} onLayout={(event) => setWidth(Math.max(220, event.nativeEvent.layout.width - 24))}>
      <Text style={{ color: '#f4db9d', fontWeight: '700' }}>Historique observé · {chart.item} · {chart.days} jours UTC</Text>
      <Text style={{ color: '#bccfd0', fontSize: 12 }}>
        Prix moyen des ventes rapportées par jour. AODP est un projet communautaire tiers, pas un service officiel d’Albion Online; ses clients envoient des observations de marché consultées par les joueurs participants. La provenance individuelle de chaque ligne n’est pas indiquée par l’API. Ces relevés peuvent être incomplets et ne couvrent pas toutes les transactions. item_count = quantité d’objets agrégée dans les observations rapportées, pas un nombre de ventes/ordres, ni du silver, ni la profondeur du carnet. Les jours sans relevé restent vides.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {chart.series.map((series, index) => (
          <Pressable
            style={{ backgroundColor: '#1d2935', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4 }}
            key={series.city}
            onPress={() => setExcluded((current) => current.includes(series.city)
              ? current.filter((city) => city !== series.city)
              : current.length === chart.series.length - 1 ? current : [...current, series.city])}
          >
            <Text style={{ color: excluded.includes(series.city) ? '#7d8989' : colors[index] }}>{excluded.includes(series.city) ? '○' : '●'} {series.city}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
        <Pressable onPress={() => { setReplay((value) => !value); setPlaying(false); setCursor(0); setSelected(null); }}>
          <Text style={{ color: '#f4db9d' }}>{replay ? 'Comparaison' : 'Replay'}</Text>
        </Pressable>
        {replay && <>
          <Pressable onPress={() => seek(cursor - 1)}><Text style={{ color: '#f4db9d' }}>◀</Text></Pressable>
          <Pressable onPress={() => { if (dayCount < 2) return; if (cursor >= dayCount - 1) setCursor(0); setPlaying((value) => !value); }}>
            <Text style={{ color: '#f4db9d' }}>{playing ? 'Pause' : 'Lecture'}</Text>
          </Pressable>
          <Pressable onPress={() => seek(cursor + 1)}><Text style={{ color: '#f4db9d' }}>▶</Text></Pressable>
          <Text style={{ color: '#fff' }}>{new Date(startDay + cursor * DAY_MS).toISOString().slice(0, 10)} UTC</Text>
        </>}
        <Pressable onPress={() => setFull((value) => !value)}><Text style={{ color: '#f4db9d' }}>{full ? 'Fermer' : 'Agrandir'}</Text></Pressable>
      </View>
      {replay && <View style={{ gap: 7 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: '#c1d2d2', fontSize: 12 }}>Jour {cursor + 1} / {dayCount}</Text>
          <Pressable accessibilityRole="button" onPress={() => setSpeed((value) => value === 1 ? 2 : value === 2 ? 4 : 1)}><Text style={{ color: '#f4db9d' }}>Vitesse {speed}×</Text></Pressable>
        </View>
        <Pressable accessibilityRole="adjustable" accessibilityLabel="Position du replay" onLayout={(event) => setTimelineWidth(event.nativeEvent.layout.width)} onPress={(event) => seek(Math.round(event.nativeEvent.locationX / Math.max(1, timelineWidth) * (dayCount - 1)))} style={{ height: 32, justifyContent: 'center' }}>
          <View style={{ height: 4, backgroundColor: '#42555d', borderRadius: 4 }}><View style={{ height: 4, width: `${dayCount > 1 ? cursor / (dayCount - 1) * 100 : 0}%`, backgroundColor: '#f4db9d' }} /></View>
        </Pressable>
        <Text style={{ color: '#a8babd', fontSize: 11 }}>Un pas par jour UTC; le prix et les quantités n’apparaissent qu’aux dates observées.</Text>
      </View>}
      <View style={{ flexDirection: 'row', gap: 18, flexWrap: 'wrap' }}>
        <Pressable accessibilityRole="button" onPress={() => setSeparate((value) => !value)}><Text style={{ color: '#f4db9d' }}>{separate ? 'Vue superposée' : 'Vue séparée'}</Text></Pressable>
        {separate && <Pressable accessibilityRole="button" onPress={() => setSharedScale((value) => !value)}><Text style={{ color: '#f4db9d' }}>{sharedScale ? 'Échelle par ville' : 'Échelle commune'}</Text></Pressable>}
      </View>
      {separate ? (
        <View style={{ gap: 12 }}>
          {visible.map((series, index) => {
            if (!series.points.length) return null;
            const localMin = sharedScale ? minP : Math.min(...series.points.map((point) => point.price));
            const localMax = sharedScale ? maxP : Math.max(...series.points.map((point) => point.price));
            const rowY = (price: number) => 8 + ((localMax - price) / Math.max(1, localMax - localMin)) * 64;
            return (
              <View key={series.city} style={{ backgroundColor: '#102029', padding: 8, borderRadius: 8, gap: 4 }}>
                <Text style={{ color: colors[index], fontWeight: '700' }}>{series.city} · {localMin}–{localMax} silver {sharedScale ? '(échelle commune)' : '(échelle propre)'}</Text>
                <Svg width={width} height={80}>
                  {[0, 1, 2].map((step) => <Line key={step} x1={10} x2={plotWidth + 10} y1={8 + step * 32} y2={8 + step * 32} stroke="#31434b" strokeWidth={0.7} />)}
                  {series.points.map((point, pointIndex) => {
                    if (point.timestamp > limit) return null;
                    const previous = series.points[pointIndex - 1];
                    return <React.Fragment key={point.timestamp}>
                      {previous && previous.timestamp <= limit && point.timestamp - previous.timestamp <= DAY_MS && <Line x1={x(previous.timestamp)} y1={rowY(previous.price)} x2={x(point.timestamp)} y2={rowY(point.price)} stroke={colors[index]} strokeWidth={2} />}
                      <Circle cx={x(point.timestamp)} cy={rowY(point.price)} r={3} fill={colors[index]} onPress={() => selectDate(point.timestamp)} />
                    </React.Fragment>;
                  })}
                </Svg>
                <VolumeMiniChart series={series} color={colors[index]} startDay={startDay} dayCount={dayCount} limit={limit} width={width} commonMax={sharedScale ? maxItemCount : undefined} selected={selected} onSelect={selectDate} />
              </View>
            );
          })}
        </View>
      ) : (
        <>
          <Svg width={width} height={height} style={{ backgroundColor: '#0b121b', borderRadius: 8 }}>
            {[0, 1, 2, 3, 4].map((step) => {
              const yy = 12 + step * (height - 42) / 4;
              return <React.Fragment key={`y-${step}`}>
                <Line x1={10} x2={plotWidth + 10} y1={yy} y2={yy} stroke="#293643" strokeWidth={0.8} />
                <SvgText x={plotWidth + 15} y={yy + 4} fill="#a5b4c3" fontSize={10}>{(maxP - (maxP - minP) * step / 4).toFixed(1)}</SvgText>
              </React.Fragment>;
            })}
            {[0, 1, 2, 3].map((step) => {
              const xx = 10 + step * plotWidth / 3;
              const date = new Date(minT + (maxT - minT) * step / 3).toISOString().slice(5, 10);
              return <React.Fragment key={`x-${step}`}>
                <Line x1={xx} x2={xx} y1={12} y2={height - 30} stroke="#263340" strokeWidth={0.8} />
                <SvgText x={xx} y={height - 8} fill="#a5b4c3" fontSize={9} textAnchor={step === 0 ? 'start' : step === 3 ? 'end' : 'middle'}>{date}</SvgText>
              </React.Fragment>;
            })}
            {replay && <Line x1={x(Math.min(maxT, startDay + cursor * DAY_MS))} x2={x(Math.min(maxT, startDay + cursor * DAY_MS))} y1={12} y2={height - 30} stroke="#f4db9d" strokeDasharray="4 4" strokeWidth={1} />}
            {visible.map((series, index) => series.points.map((point, pointIndex) => {
              if (point.timestamp > limit) return null;
              const previous = series.points[pointIndex - 1];
              return <React.Fragment key={`${series.city}-${point.timestamp}`}>
                {previous && previous.timestamp <= limit && point.timestamp - previous.timestamp <= DAY_MS && <Line x1={x(previous.timestamp)} y1={y(previous.price, minP, maxP)} x2={x(point.timestamp)} y2={y(point.price, minP, maxP)} stroke={colors[index]} strokeWidth={2} />}
                <Circle cx={x(point.timestamp)} cy={y(point.price, minP, maxP)} r={2.5} fill={colors[index]} onPress={() => selectDate(point.timestamp)} />
              </React.Fragment>;
            }))}
          </Svg>
          <View style={{ gap: 4, backgroundColor: '#0b121b', borderRadius: 8, padding: 8 }}>
            <Text style={{ color: '#c1d2d2', fontSize: 11 }}>Quantité rapportée par ville (item_count), sur une échelle commune de 0 à {formatQuantity(maxItemCount)} objets/jour.</Text>
            {visible.map((series, index) => (
              <VolumeMiniChart key={series.city} series={series} color={colors[index]} startDay={startDay} dayCount={dayCount} limit={limit} width={width - 16} commonMax={maxItemCount} selected={selected} onSelect={selectDate} />
            ))}
          </View>
        </>
      )}
      <Text style={{ color: '#c1d2d2', fontSize: 12 }}>{new Date(minT).toISOString().slice(0, 10)} → {new Date(maxT).toISOString().slice(0, 10)} UTC{!separate ? ` · ${minP}–${maxP} silver` : ''}</Text>
      {selected !== null && <Text style={{ color: '#fff', fontSize: 12 }}>
        {new Date(selected).toISOString().slice(0, 10)} UTC : {visible.map((series) => {
          const point = series.points.find((entry) => entry.timestamp === selected);
          return point
            ? `${series.city}: ${point.price} silver · ${formatQuantity(point.itemCount)} objets (item_count)`
            : `${series.city}: aucune observation`;
        }).join(' · ')}
      </Text>}
    </View>
  );

  return <><View>{!full && content}</View><Modal visible={full} onRequestClose={() => setFull(false)}><ScrollView style={{ flex: 1, backgroundColor: '#0c1823' }} contentContainerStyle={{ paddingTop: 50 }}>{content}</ScrollView></Modal></>;
}

export default React.memo(HistoryChartCard);
