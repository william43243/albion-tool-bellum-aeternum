import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

export const ScreenActiveContext = createContext(true);
export const useScreenActive = () => useContext(ScreenActiveContext);

export function useAppForeground() {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => sub.remove();
  }, []);
  return foreground;
}

/** A request owns a query and visibility epoch, not just a mounted component. */
export function useRequestScope(key: string) {
  const active = useScreenActive();
  const latest = useRef({ active, key });
  latest.current = { active, key };
  const controller = useRef<AbortController | null>(null);
  const cancel = () => { controller.current?.abort(); controller.current = null; };
  useEffect(() => {
    cancel();
    return cancel;
  }, [active, key]);
  return {
    cancel,
    begin() {
      cancel();
      if (!latest.current.active) return null;
      const requestKey = latest.current.key;
      const own = new AbortController();
      controller.current = own;
      return {
        signal: own.signal,
        current: () => !own.signal.aborted && controller.current === own &&
          latest.current.active && latest.current.key === requestKey,
      };
    },
  };
}
