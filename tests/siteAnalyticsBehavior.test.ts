import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

test('website revocation in another tab immediately disables transport', async () => {
  const source = readFileSync('site/js/analytics.js', 'utf8');
  const windowListeners = new Map<string, (event: any) => void>();
  const documentListeners = new Map<string, () => void>();
  const elements = new Map<string, any>();
  for (const id of ['analyticsConsent', 'analyticsAccept', 'analyticsRefuse', 'analyticsSettings']) {
    elements.set(id, { hidden: true, focus() {}, addEventListener() {} });
  }
  const fetches: string[] = [];
  let storedConsent = 'accepted';
  const windowObject: any = {
    location: { pathname: '/' },
    addEventListener(name: string, listener: (event: any) => void) { windowListeners.set(name, listener); },
  };
  const context = vm.createContext({
    window: windowObject,
    localStorage: {
      getItem: () => storedConsent,
      setItem() {},
    },
    document: {
      activeElement: null,
      addEventListener(name: string, listener: () => void) { documentListeners.set(name, listener); },
      getElementById(id: string) { return elements.get(id) || null; },
      querySelectorAll() { return []; },
    },
    fetch: async (path: string) => { fetches.push(path); return {}; },
    Object,
  });

  vm.runInContext(source, context);
  windowObject.AlbionAnalytics.trackPageView('/');
  assert.equal(fetches.length, 1);

  const storageListener = windowListeners.get('storage');
  assert.ok(storageListener, 'storage listener must be registered');
  storedConsent = 'refused';
  storageListener({ key: 'albion_analytics_consent', newValue: 'refused' });
  assert.equal(windowObject.AlbionAnalytics.getConsent(), 'refused');
  storageListener({ key: 'albion_analytics_consent', newValue: 'accepted' });
  assert.equal(windowObject.AlbionAnalytics.getConsent(), 'refused');
  windowObject.AlbionAnalytics.trackPageView('/');
  assert.equal(fetches.length, 1);
});

test('failed website refusal write removes stale acceptance, and total failure stays visible and fail-closed', () => {
  const source = readFileSync('site/js/analytics.js', 'utf8');
  let stored: string | null = 'accepted';
  let removeFails = false;
  let alerts = 0;
  const dialog: any = { hidden: true, focus() {}, addEventListener() {}, querySelectorAll() { return []; } };
  const accept: any = { focus() {}, addEventListener() {} };
  const elements = new Map<string, any>([['analyticsConsent', dialog], ['analyticsAccept', accept]]);
  const windowObject: any = {
    location: { pathname: '/' },
    addEventListener() {},
    alert() { alerts += 1; },
  };
  const context = vm.createContext({
    window: windowObject,
    localStorage: {
      getItem: () => stored,
      setItem() { throw new Error('quota'); },
      removeItem() { if (removeFails) throw new Error('blocked'); stored = null; },
    },
    document: {
      documentElement: { lang: 'en' }, activeElement: null, addEventListener() {},
      getElementById(id: string) { return elements.get(id) || null; }, querySelectorAll() { return []; },
    },
    fetch: async () => ({}), Object,
  });
  vm.runInContext(source, context);

  assert.equal(windowObject.AlbionAnalytics.setConsent('refused'), true);
  assert.equal(stored, null);
  assert.equal(windowObject.AlbionAnalytics.getConsent(), 'refused');
  assert.equal(alerts, 0);

  stored = 'accepted';
  removeFails = true;
  assert.equal(windowObject.AlbionAnalytics.setConsent('refused'), false);
  assert.equal(windowObject.AlbionAnalytics.getConsent(), 'undecided');
  assert.equal(dialog.hidden, false);
  assert.equal(alerts, 1);
});

test('website consent dialog traps forward and reverse keyboard focus', () => {
  const source = readFileSync('site/js/analytics.js', 'utf8');
  const documentListeners = new Map<string, () => void>();
  const dialogListeners = new Map<string, (event: any) => void>();
  const first: any = { focus() { documentObject.activeElement = first; }, addEventListener() {} };
  const last: any = { focus() { documentObject.activeElement = last; }, addEventListener() {} };
  const dialog: any = {
    hidden: false,
    addEventListener(name: string, listener: (event: any) => void) { dialogListeners.set(name, listener); },
    querySelectorAll() { return [first, last]; },
  };
  const elements = new Map<string, any>([
    ['analyticsConsent', dialog], ['analyticsAccept', last], ['analyticsRefuse', first],
    ['analyticsSettings', { addEventListener() {} }],
  ]);
  const documentObject: any = {
    documentElement: { lang: 'en' }, activeElement: first,
    addEventListener(name: string, listener: () => void) { documentListeners.set(name, listener); },
    getElementById(id: string) { return elements.get(id) || null; }, querySelectorAll() { return []; },
  };
  const windowObject: any = { location: { pathname: '/' }, addEventListener() {}, alert() {} };
  vm.runInContext(source, vm.createContext({
    window: windowObject, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: documentObject, fetch: async () => ({}), Object,
  }));
  documentListeners.get('DOMContentLoaded')?.();
  const keydown = dialogListeners.get('keydown');
  assert.ok(keydown);

  let prevented = false;
  documentObject.activeElement = first;
  keydown({ key: 'Tab', shiftKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(documentObject.activeElement, last);

  prevented = false;
  keydown({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(documentObject.activeElement, first);
});
