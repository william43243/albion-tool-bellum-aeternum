import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { COLORS } from '../constants/theme';

export type BellumIconName =
  | 'marketplace' | 'crafting' | 'flipping' | 'history' | 'advisor' | 'map' | 'plan' | 'settings'
  | 'back' | 'chevronDown' | 'plus' | 'more' | 'arrowDown' | 'send' | 'stop' | 'camera' | 'image'
  | 'trash' | 'close' | 'swap' | 'pin' | 'check' | 'search' | 'refresh' | 'warning' | 'info' | 'expand' | 'collapse';

type Props = {
  name: BellumIconName;
  size?: number;
  color?: string;
  selected?: boolean;
};

const strokes: Partial<Record<BellumIconName, string>> = {
  back: 'M19 12H5m6-6-6 6 6 6',
  chevronDown: 'm6 9 6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  arrowDown: 'M12 5v14m-6-6 6 6 6-6',
  camera: 'M3 7h4l2-3h6l2 3h4v13H3z',
  image: 'M3 4h18v16H3zM4 17l5-5 4 4 3-3 4 4',
  trash: 'M4 6h16M8 6V3h8v3m2 0-1 15H7L6 6m4 4v7m4-7v7',
  close: 'm6 6 12 12M18 6 6 18',
  swap: 'M4 8h15m-4-4 4 4-4 4m5 4H5m4-4-4 4 4 4',
  check: 'm4 12 5 5L20 6',
  refresh: 'M20 10a8 8 0 1 0-.5 5M20 4v6h-6',
  warning: 'M12 3 22 21H2zM12 9v4',
  info: 'M12 11v5',
  expand: 'M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6',
  collapse: 'M9 3v6H3m18 0h-6V3m0 18v-6h6M3 15h6v6',
};

/** The originals are drawn on one 24-unit grid. Set the accessible label on the button, not the SVG. */
export default function BellumIcon({ name, size = 24, color = COLORS.text, selected = false }: Props) {
  const line = (d: string) => (
    <Path d={d} fill="none" stroke={color} strokeWidth={selected ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" />
  );
  const solid = (d: string) => <Path d={d} fill={color} fillRule="evenodd" />;
  const dot = (cx: number, cy: number, r: number) => <Circle cx={cx} cy={cy} r={r} fill={color} />;
  const ring = (cx: number, cy: number, r: number) => <Circle cx={cx} cy={cy} r={r} stroke={color} strokeWidth={1.8} fill="none" />;
  let glyph;
  switch (name) {
    case 'marketplace':
      glyph = <>
        {line('M12 3v17m-5 0h10M5 6h14M6 6l-3 7m3-7 3 7m9-7-3 7m3-7 3 7')}
        {selected ? solid('M2 12h8c0 3-1.8 5-4 5s-4-2-4-5Zm12 0h8c0 3-1.8 5-4 5s-4-2-4-5Z') : line('M3 13h6a3 3 0 0 1-6 0Zm12 0h6a3 3 0 0 1-6 0Z')}
      </>;
      break;
    case 'crafting':
      glyph = <>
        {selected ? solid('M2 8h6V5h13l-2 5-6 3v3l4 3v2H7v-2l3-3v-3C5 13 3 11 2 8Z') : line('M2 8h6V5h13l-2 5-6 3v3l4 3v2H7v-2l3-3v-3C5 13 3 11 2 8Z')}
      </>;
      break;
    case 'flipping':
      glyph = selected ? solid('M14 3l7 5-7 5v-3H3V6h11V3ZM10 11l-7 5 7 5v-3h11v-4H10v-3Z') : line(strokes.swap!);
      break;
    case 'history':
      glyph = <>{ring(12, 12, 8.5)}{line('M12 6v6l4 2')}{selected && dot(12, 12, 2)}</>;
      break;
    case 'advisor':
      glyph = selected ? solid('M3 4h18v12h-9l-6 5v-5H3V4Zm5 7h2V9H8v2Zm4 0h2V9h-2v2Zm4 0h2V9h-2v2Z') :
        <>{line('M3 4h18v12h-9l-6 5v-5H3z')}{dot(9, 10, 1)}{dot(13, 10, 1)}{dot(17, 10, 1)}</>;
      break;
    case 'map':
      glyph = <>{selected && solid('M3 6l6-3v15l-6 3Zm12 0 6-3v15l-6 3Z')}{line('m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15')}</>;
      break;
    case 'plan':
      glyph = selected ? solid('M5 3h14v18H5zM7 8v2h2V8zm0 5v2h2v-2zm4-5v2h5V8zm0 5v2h5v-2z') :
        <>{line('M5 3h14v18H5zM10 9h6m-6 5h6')}{dot(8, 9, 0.85)}{dot(8, 14, 0.85)}</>;
      break;
    case 'settings':
      glyph = <>
        {selected ? solid('M9 3h6l.6 3 2 1 3-.8 2 4-2.3 2.2v2l2.3 2.2-2 4-3-.8-2 1-.6 2.2H9l-.6-2.2-2-1-3 .8-2-4 2.3-2.2v-2L1.4 10l2-4 3 .8 2-1zM9 13a3 3 0 1 0 6 0 3 3 0 1 0-6 0Z') :
          <>{line('M9 3h6l.5 2.8 2.1 1.2 2.7-1 1.7 3-2.2 2v2.1l2.2 2-1.7 3-2.7-1-2.1 1.2L15 21H9l-.5-2.7-2.1-1.2-2.7 1-1.7-3 2.2-2V11L2 9l1.7-3 2.7 1 2.1-1.2z')}{ring(12, 12, 2.8)}</>}
      </>;
      break;
    case 'more':
      glyph = <>{dot(5, 12, 1.65)}{dot(12, 12, 1.65)}{dot(19, 12, 1.65)}</>;
      break;
    case 'send':
      glyph = solid('M12 3 3 11l2 2 5-4v12h4V9l5 4 2-2z');
      break;
    case 'stop':
      glyph = solid('M6 6h12v12H6z');
      break;
    case 'camera':
      glyph = <>{line(strokes.camera!)}{ring(12, 13, 3.1)}</>;
      break;
    case 'image':
      glyph = <>{line(strokes.image!)}{dot(15, 8, 1.2)}</>;
      break;
    case 'pin':
      glyph = <>{line('M12 21c-2-2.7-6-6.3-6-11a6 6 0 0 1 12 0c0 4.7-4 8.3-6 11Z')}{ring(12, 10, 1.8)}</>;
      break;
    case 'search':
      glyph = <>{ring(10, 10, 5.5)}{line('m14 14 5 5')}</>;
      break;
    case 'info':
      glyph = <>{ring(12, 12, 9)}{dot(12, 8, 0.9)}{line(strokes.info!)}</>;
      break;
    case 'warning':
      glyph = <>{line(strokes.warning!)}{dot(12, 17, 1)}</>;
      break;
    default:
      glyph = line(strokes[name]!);
      break;
  }

  return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>{glyph}</Svg>;
}
