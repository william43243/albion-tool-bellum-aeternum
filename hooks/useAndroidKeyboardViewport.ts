import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { AppState, Keyboard, Platform, View } from 'react-native';
import { keyboardViewportHeight } from '../components/chat/keyboardViewport';

/** One Android IME owner at the application root, including edge-to-edge. */
export function useAndroidKeyboardViewport(enabled: boolean) {
  const rootRef = useRef<ComponentRef<typeof View>>(null);
  const [frame, setFrame] = useState({ height: 0, screenY: 0 });
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  const measureRoot = useCallback(() => {
    rootRef.current?.measureInWindow((_x, screenY, _width, height) => {
      if (height > 0) setFrame(previous => previous.height === height && previous.screenY === screenY ? previous : { height, screenY });
    });
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'android' || !enabled) { setKeyboardTop(null); return; }
    const sync = () => {
      setKeyboardTop(Keyboard.isVisible() ? Keyboard.metrics()?.screenY ?? null : null);
      measureRoot();
    };
    const show = Keyboard.addListener('keyboardDidShow', event => { setKeyboardTop(event.endCoordinates.screenY); measureRoot(); });
    const hide = Keyboard.addListener('keyboardDidHide', () => { setKeyboardTop(null); measureRoot(); });
    const app = AppState.addEventListener('change', state => { if (state === 'active') sync(); });
    sync();
    return () => { show.remove(); hide.remove(); app.remove(); };
  }, [enabled, measureRoot]);
  const maxHeight = enabled && Platform.OS === 'android'
    ? keyboardViewportHeight(frame.height, frame.screenY, keyboardTop) : undefined;
  return { rootRef, measureRoot, maxHeight, keyboardVisible: maxHeight !== undefined };
}
