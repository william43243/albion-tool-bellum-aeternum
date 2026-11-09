import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the actual screen callback without loading React Native. Its only
// TypeScript-only declaration is erased; networking and state setters are fakes.
const screen = readFileSync('screens/HistoryScreen.tsx', 'utf8');
const callback = screen.match(/const fetchHistory = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[selectedItems/)?.[1];
assert.ok(callback, 'HistoryScreen fetch callback must be found');
const buildRequest = new Function('env', `with (env) { return async function () { ${callback.replace('const allData: HistoryResponse[]', 'const allData')} }; }`);
const invalidateBody = screen.match(/useEffect\(\(\) => \{\s*\/\/ Invalidate completed([\s\S]*?)\n  \}, \[historyConfigKey\]\)/)?.[1];
assert.ok(invalidateBody, 'selection-change invalidation must be found');
const invalidate = new Function('env', `with (env) { return (function () { // Invalidate completed${invalidateBody}\n})(); }`);

function harness() {
  let resolve!: (data: unknown[]) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<unknown[]>((res, rej) => { resolve = res; reject = rej; });
  const state = { data: [] as unknown[], loading: false, alerts: [] as string[] };
  const env = {
    selectedItems: [{ id: 'T4_BAG' }], selectedCities: new Set(['Caerleon']),
    period: 30, timeScale: 24, server: 'americas', quality: 1,
    historyConfigKey: 'T4_BAG|Caerleon|americas|1|30|24',
    historyConfigRef: { current: 'T4_BAG|Caerleon|americas|1|30|24' },
    requestGeneration: { current: 0 },
    setLoading(value: boolean) { state.loading = value; },
    setHistoryData(value: unknown[]) { state.data = value; },
    formatDateForApi: () => '11-5-2026', daysAgo: () => new Date(),
    fetchPriceHistory: () => pending,
    Alert: { alert(_title: string, message: string) { state.alerts.push(message); } },
    t: (key: string) => key,
  };
  return { env, state, resolve, reject, request: buildRequest(env) as () => Promise<void> };
}

test('history response is ignored if selection changes before its promise settles', async () => {
  const h = harness();
  const pending = h.request();
  h.env.historyConfigRef.current = 'T4_BAG|Caerleon|americas|5|30|24';
  invalidate(h.env);
  h.resolve([{ quality: 1 }]);
  await pending;
  assert.deepEqual(h.state.data, []);
  assert.equal(h.state.loading, false);
});

test('history response is rejected even before selection-change effect runs', async () => {
  const h = harness();
  const pending = h.request();
  h.env.historyConfigRef.current = 'T4_BAG|Caerleon|europe|1|30|24';
  h.resolve([{ quality: 1 }]);
  await pending;
  assert.deepEqual(h.state.data, []);
});

test('stale history failure cannot alert or stop a newer loading state', async () => {
  const h = harness();
  const pending = h.request();
  h.env.requestGeneration.current += 1;
  h.state.loading = true;
  h.reject(new Error('old response'));
  await pending;
  assert.deepEqual(h.state.alerts, []);
  assert.equal(h.state.loading, true);
});

test('current history request finishes normally and selection changes clear loaded data', async () => {
  const h = harness();
  const pending = h.request();
  h.resolve([{ quality: 1 }]);
  await pending;
  assert.deepEqual(h.state.data, [{ quality: 1 }]);
  assert.equal(h.state.loading, false);
  const cleanup = invalidate(h.env) as () => void;
  assert.deepEqual(h.state.data, []);
  const generation = h.env.requestGeneration.current;
  cleanup();
  assert.equal(h.env.requestGeneration.current, generation + 1, 'unmount also invalidates requests');
  assert.match(screen, /historyConfigKey = `\$\{liveConfigKey\}\|\$\{period\}\|\$\{timeScale\}`/);
});
