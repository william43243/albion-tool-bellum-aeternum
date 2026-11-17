import { CITIES, SERVERS, type City, type PriceData, type Quality, type Server } from './api';
import { parseAodpTimestamp } from './aodpTime';

/** Device-local observations only. This is not an exportable market archive. */
export const PRODUCTION_MARKET_CACHE_KEY = '@albion/production-market/v1';
const MAX_ROWS = 5000;
const MAX_ITEMS = 200;
const CHUNK = 25;
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE = 5 * 60 * 1000;
type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
type Fetcher = (url: string, options?: RequestInit) => Promise<Response>;
type CacheRow = { server: Server; fetchedAt: number; price: PriceData };
type HistoryPoint = { timestamp: string; itemCount: number; averagePrice: number };
type HistoryCache = {server:Server;itemId:string;city:City;quality:Quality;startMs:number;endMs:number;fetchedAt:number;points:HistoryPoint[]};
export type ProductionQuote = { value: number; observedAt: string; ageMs: number; fresh: boolean };
export type ProductionMarketRow = { itemId: string; city: City; quality: Quality; source: 'AODP'; fetchedAt: number; purchaseImmediate: ProductionQuote | null; saleImmediate: ProductionQuote | null; saleOrderReference: ProductionQuote | null };
export type ProductionMarketResult = { rows: ProductionMarketRow[]; offline: boolean; error: string | null; cachePersistent: boolean };
export type ProductionMarketQuery = { server: Server; itemIds: string[]; cities: City[]; quality: Quality; maxAgeMs: number; offlineOnly?: boolean; forceRefresh?: boolean; signal?: AbortSignal };
export type ProductionHistoryQuery = {server:Server;itemId:string;city:City;quality:Quality;days:number;maxAgeMs:number;offlineOnly?:boolean;forceRefresh?:boolean;signal?:AbortSignal};
export type ProductionHistoryResult = {source:'AODP';itemId:string;city:City;quality:Quality;startMs:number;endMs:number;fetchedAt:number|null;fresh:boolean;observedBuckets:number;requestedDays:number;observedUnits:number|null;points:HistoryPoint[];offline:boolean;error:string|null;cachePersistent:boolean};
const abortError = () => Object.assign(new Error('Market request cancelled'), { name: 'AbortError' });
const rowKey = (r: CacheRow) => `${r.server}:${r.price.item_id}:${r.price.city}:${r.price.quality}`;
const asQuote = (value: number, date: string, now: number, maxAge: number): ProductionQuote | null => {
  const time = parseAodpTimestamp(date);
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(time) || time > now + FUTURE_TOLERANCE) return null;
  const ageMs = Math.max(0, now - time);
  return { value, observedAt: date, ageMs, fresh: ageMs <= maxAge };
};
function validPrice(p: unknown): p is PriceData {
  if (!p || typeof p !== 'object') return false;
  const x = p as PriceData;
  return typeof x.item_id === 'string' && /^[A-Z0-9_@.-]{1,100}$/.test(x.item_id) && CITIES.includes(x.city as City)
    && Number.isInteger(x.quality) && x.quality >= 1 && x.quality <= 5
    && ['sell_price_min','sell_price_max','buy_price_min','buy_price_max'].every(k => typeof (x as any)[k] === 'number' && Number.isFinite((x as any)[k]) && (x as any)[k] >= 0)
    && ['sell_price_min_date','sell_price_max_date','buy_price_min_date','buy_price_max_date'].every(k => typeof (x as any)[k] === 'string');
}
type Shared<T> = { promise: Promise<T>; controller: AbortController; users: number };

export function createProductionMarketClient(storage: Storage, fetcher: Fetcher, clock: () => number = Date.now) {
  const cache = new Map<string, CacheRow>();
  const histories = new Map<string, HistoryCache>();
  const pending = new Map<string, Shared<PriceData[]>>();
  const historyPending = new Map<string, Shared<HistoryPoint[]>>();
  const retryAt: Partial<Record<Server, number>> = {};
  let loaded: Promise<void> | undefined;
  let persistent = true;
  let writeQueue: Promise<void> = Promise.resolve();
  async function load() {
    if (!loaded) loaded = (async () => {
      try {
        const raw = await storage.getItem(PRODUCTION_MARKET_CACHE_KEY);
        if (!raw) return;
        const value = JSON.parse(raw);
        if (value.version !== 1 || !Array.isArray(value.rows) || value.rows.length > MAX_ROWS) throw new Error('Invalid market cache');
        for (const row of value.rows) {
        if (!Object.prototype.hasOwnProperty.call(SERVERS,row.server) || !Number.isFinite(row.fetchedAt) || row.fetchedAt > clock() + FUTURE_TOLERANCE || !validPrice(row.price)) throw new Error('Invalid market cache row');
          cache.set(rowKey(row), row);
        }
        if (value.histories !== undefined && (!Array.isArray(value.histories) || value.histories.length > 100)) throw new Error('Invalid history cache');
        for (const h of value.histories ?? []) {
          if (!Object.prototype.hasOwnProperty.call(SERVERS,h.server) || typeof h.itemId !== 'string' || !/^[A-Z0-9_@.-]{1,100}$/.test(h.itemId) || !CITIES.includes(h.city) || !Number.isInteger(h.quality) || h.quality<1 || h.quality>5 || !Number.isFinite(h.startMs) || !Number.isFinite(h.endMs) || h.endMs<=h.startMs || !Number.isFinite(h.fetchedAt) || h.fetchedAt>clock()+FUTURE_TOLERANCE || !Array.isArray(h.points) || h.points.length>90 || h.points.some((p:HistoryPoint)=>typeof p.timestamp!=='string' || !Number.isSafeInteger(p.itemCount) || p.itemCount<0 || !Number.isFinite(p.averagePrice) || p.averagePrice<0 || !Number.isFinite(parseAodpTimestamp(p.timestamp)) || parseAodpTimestamp(p.timestamp)<h.startMs || parseAodpTimestamp(p.timestamp)>=h.endMs)) throw new Error('Invalid history cache row');
          const stamps=h.points.map((p:HistoryPoint)=>parseAodpTimestamp(p.timestamp));
          if(stamps.some((n:number)=>n%86400000!==0) || new Set(stamps).size!==stamps.length) throw new Error('Invalid history cache buckets');
          histories.set(`${h.server}:${h.itemId}:${h.city}:${h.quality}:${h.startMs}:${h.endMs}`,h);
        }
      } catch { cache.clear(); histories.clear(); persistent = false; }
    })();
    await loaded;
  }
  async function save() {
    if (!persistent) return;
    const rows = [...cache.values()].sort((a,b) => b.fetchedAt - a.fetchedAt).slice(0, MAX_ROWS);
    cache.clear(); for (const row of rows) cache.set(rowKey(row), row);
    const historyRows = [...histories.values()].sort((a,b)=>b.fetchedAt-a.fetchedAt).slice(0,100);
    histories.clear();for(const h of historyRows)histories.set(`${h.server}:${h.itemId}:${h.city}:${h.quality}:${h.startMs}:${h.endMs}`,h);
    const data = JSON.stringify({version:1, rows, histories:historyRows});
    writeQueue = writeQueue.then(() => storage.setItem(PRODUCTION_MARKET_CACHE_KEY,data)).catch(() => { persistent = false; });
    await writeQueue;
  }
  function join<T>(shared: Shared<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError());
    shared.users++;
    return new Promise((resolve,reject) => {
      let done = false;
      const finish = () => { if (done) return false; done = true; signal?.removeEventListener('abort', onAbort); shared.users--; if (!shared.users) shared.controller.abort(); return true; };
      const onAbort = () => { if (finish()) reject(abortError()); };
      signal?.addEventListener('abort',onAbort,{once:true});
      shared.promise.then(value => { if (finish()) resolve(value); }, error => { if (finish()) reject(error); });
      if (signal?.aborted) onAbort();
    });
  }
  function checkResponse(response:Response,server:Server) {
    if (response.status === 429) {
      const now = clock(), raw = response.headers.get('Retry-After');
      const seconds = raw === null ? NaN : Number(raw);
      const retry = Number.isFinite(seconds) && seconds > 0 ? now + seconds * 1000 : Date.parse(raw ?? '');
      const reset = Number(response.headers.get('RateLimit-Reset')) * 1000;
      const deadlines = [retry,reset].filter(value => Number.isFinite(value) && value > now);
      retryAt[server] = deadlines.length ? Math.max(...deadlines) : now + 300000;
      throw new Error('AODP_RATE_LIMITED');
    }
    if (!response.ok) throw new Error(`AODP_HTTP_${response.status}`);
  }
  async function fetchChunk(server: Server, ids: string[], cities: City[], quality: Quality, signal?: AbortSignal) {
    const key = `${server}:${quality}:${cities.join(',')}:${ids.join(',')}`;
    let shared = pending.get(key);
    if (shared?.controller.signal.aborted) { pending.delete(key); shared = undefined; }
    if (!shared) {
      if ((retryAt[server] ?? 0) > clock()) throw new Error('AODP_RATE_LIMITED');
      const controller = new AbortController();
      const url = `${SERVERS[server]}/prices/${encodeURIComponent(ids.join(','))}.json?locations=${encodeURIComponent(cities.join(','))}&qualities=${quality}`;
      const promise = (async () => {
        const response = await fetcher(url,{signal:controller.signal,cache:'no-store'});
        checkResponse(response,server);
        const data: unknown = await response.json();
        if (!Array.isArray(data)) throw new Error('AODP_INVALID_RESPONSE');
        return data.filter((p): p is PriceData => validPrice(p) && ids.includes(p.item_id) && cities.includes(p.city as City) && p.quality === quality);
      })();
      shared = {promise, controller, users:0}; pending.set(key,shared);
      const current = shared; promise.finally(() => { if (pending.get(key) === current) pending.delete(key); }).catch(() => {});
    }
    return join(shared,signal);
  }
  async function getPrices(query: ProductionMarketQuery): Promise<ProductionMarketResult> {
    if (!Object.prototype.hasOwnProperty.call(SERVERS,query.server) || !Number.isInteger(query.quality) || query.quality < 1 || query.quality > 5 || !Number.isFinite(query.maxAgeMs) || query.maxAgeMs <= 0 || query.maxAgeMs > MAX_AGE) throw new Error('INVALID_MARKET_QUERY');
    const ids = [...new Set(query.itemIds)].sort(), cities = [...new Set(query.cities)].sort();
    if (!ids.length || ids.length > MAX_ITEMS || ids.some(x => !/^[A-Z0-9_@.-]{1,100}$/.test(x)) || !cities.length || cities.some(x => !CITIES.includes(x))) throw new Error('INVALID_MARKET_QUERY');
    if (query.signal?.aborted) throw abortError();
    await load();
    if (query.signal?.aborted) throw abortError();
    let error: string | null = null;
    if (!query.offlineOnly) {
      try {
        const missing = ids.filter(id => query.forceRefresh || cities.some(city => {
          const row = cache.get(`${query.server}:${id}:${city}:${query.quality}`);
          return !row || clock() - row.fetchedAt > Math.min(query.maxAgeMs,30*60*1000);
        }));
        for (let i=0; i<missing.length; i+=CHUNK) {
          if (query.signal?.aborted) throw abortError();
          const rows = await fetchChunk(query.server,missing.slice(i,i+CHUNK),cities,query.quality,query.signal);
          if (query.signal?.aborted) throw abortError();
          const fetchedAt = clock();
          for (const price of rows) cache.set(rowKey({server:query.server,fetchedAt,price}),{server:query.server,fetchedAt,price});
          await save();
        }
      } catch (e) {
        if ((e as Error)?.name === 'AbortError' || query.signal?.aborted) throw abortError();
        error = e instanceof Error ? e.message : 'AODP_UNAVAILABLE';
      }
    }
    if (query.signal?.aborted) throw abortError();
    const now=clock();
    const rows: ProductionMarketRow[]=[];
    for (const id of ids) for (const city of cities) {
      const item=cache.get(`${query.server}:${id}:${city}:${query.quality}`); if (!item) continue;
      const p=item.price;
      rows.push({itemId:id,city,quality:query.quality,source:'AODP',fetchedAt:item.fetchedAt,
        purchaseImmediate:asQuote(p.sell_price_min,p.sell_price_min_date,now,query.maxAgeMs),
        saleImmediate:asQuote(p.buy_price_max,p.buy_price_max_date,now,query.maxAgeMs),
        saleOrderReference:asQuote(p.sell_price_min,p.sell_price_min_date,now,query.maxAgeMs)});
    }
    return {rows,offline:!!query.offlineOnly || !!error,error,cachePersistent:persistent};
  }
  async function getHistory(query:ProductionHistoryQuery):Promise<ProductionHistoryResult> {
    if (!Object.prototype.hasOwnProperty.call(SERVERS,query.server) || !/^[A-Z0-9_@.-]{1,100}$/.test(query.itemId) || !CITIES.includes(query.city) || !Number.isInteger(query.quality) || query.quality<1 || query.quality>5 || !Number.isInteger(query.days) || query.days<1 || query.days>90 || !Number.isFinite(query.maxAgeMs) || query.maxAgeMs<=0 || query.maxAgeMs>MAX_AGE) throw new Error('INVALID_MARKET_QUERY');
    if(query.signal?.aborted)throw abortError();
    await load();if(query.signal?.aborted)throw abortError();
    const endMs=Math.floor(clock()/86400000)*86400000, startMs=endMs-query.days*86400000;
    const key=`${query.server}:${query.itemId}:${query.city}:${query.quality}:${startMs}:${endMs}`;
    let snapshot=histories.get(key), error:string|null=null;
    if(!query.offlineOnly && (query.forceRefresh || !snapshot || clock()-snapshot.fetchedAt>Math.min(query.maxAgeMs,30*60*1000))) {
      try {
        let shared=historyPending.get(key);
        if(shared?.controller.signal.aborted){historyPending.delete(key);shared=undefined;}
        if(!shared) {
          if((retryAt[query.server]??0)>clock())throw new Error('AODP_RATE_LIMITED');
          const controller=new AbortController();
          const apiDate=(ms:number)=>{const d=new Date(ms);return `${d.getUTCMonth()+1}-${d.getUTCDate()}-${d.getUTCFullYear()}`;};
          const url=`${SERVERS[query.server]}/history/${encodeURIComponent(query.itemId)}.json?locations=${encodeURIComponent(query.city)}&date=${apiDate(startMs)}&end_date=${apiDate(endMs)}&time-scale=24&qualities=${query.quality}`;
          const promise=(async()=>{
            const response=await fetcher(url,{signal:controller.signal,cache:'no-store'});checkResponse(response,query.server);
            const raw:unknown=await response.json();if(!Array.isArray(raw))throw new Error('AODP_INVALID_RESPONSE');
            const matching=raw.filter((h:any)=>h && h.location===query.city && h.item_id===query.itemId && h.quality===query.quality && Array.isArray(h.data));
            if(matching.length>1)throw new Error('AODP_AMBIGUOUS_HISTORY');
            const points:HistoryPoint[]=[], days=new Set<number>();
            for(const p of matching[0]?.data ?? []) {
              const ms=typeof p.timestamp==='string'?parseAodpTimestamp(p.timestamp):NaN;
              if(!Number.isFinite(ms) || ms<startMs || ms>=endMs || ms%86400000!==0 || !Number.isSafeInteger(p.item_count) || p.item_count<0 || !Number.isFinite(p.avg_price) || p.avg_price<0)continue;
              if(days.has(ms))throw new Error('AODP_AMBIGUOUS_HISTORY');
              days.add(ms);points.push({timestamp:p.timestamp,itemCount:p.item_count,averagePrice:p.avg_price});
            }
            return points.sort((a,b)=>parseAodpTimestamp(a.timestamp)-parseAodpTimestamp(b.timestamp));
          })();
          shared={promise,controller,users:0};historyPending.set(key,shared);
          const current=shared;promise.finally(()=>{if(historyPending.get(key)===current)historyPending.delete(key);}).catch(()=>{});
        }
        const points=await join(shared,query.signal);if(query.signal?.aborted)throw abortError();
        snapshot={server:query.server,itemId:query.itemId,city:query.city,quality:query.quality,startMs,endMs,fetchedAt:clock(),points};histories.set(key,snapshot);await save();
      } catch(e) {if((e as Error)?.name==='AbortError'||query.signal?.aborted)throw abortError();error=e instanceof Error?e.message:'AODP_UNAVAILABLE';}
    }
    if(query.signal?.aborted)throw abortError();
    const units=snapshot?.points.reduce((sum,p)=>sum+p.itemCount,0)??0;
    return {source:'AODP',itemId:query.itemId,city:query.city,quality:query.quality,startMs,endMs,fetchedAt:snapshot?.fetchedAt??null,fresh:!!snapshot&&clock()-snapshot.fetchedAt<=query.maxAgeMs,observedBuckets:snapshot?.points.length??0,requestedDays:query.days,observedUnits:snapshot?.points.length && Number.isSafeInteger(units)?units:null,points:snapshot?.points??[],offline:!!query.offlineOnly||!!error,error,cachePersistent:persistent};
  }
  return { getPrices, getHistory };
}
