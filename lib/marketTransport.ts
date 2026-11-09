/** Android market reads use the native bounded transport. Web keeps browser fetch. */
export interface NativeMarketTransport {
  request(id: string, url: string): Promise<{ status: number; body: string; retryAfter: string | null; rateLimitReset: string | null }>;
  cancel(id: string): void;
}

let nativeTransport: NativeMarketTransport | null = null;
let nativeRequired = false;
let sequence = 0;

export function configureMarketTransport(required: boolean, transport?: NativeMarketTransport | null): void {
  nativeRequired = required;
  nativeTransport = transport ?? null;
}

function aborted(): Error { return Object.assign(new Error('Market request cancelled'), { name: 'AbortError' }); }

export async function marketFetch(url: string, options: RequestInit = {}): Promise<Response> {
  if (!nativeRequired) return fetch(url, options);
  if (!nativeTransport) throw new Error('Market transport unavailable');
  const transport = nativeTransport;
  const signal = options.signal;
  if (signal?.aborted) throw aborted();
  const id = `market-${++sequence}`;
  const onAbort = () => transport.cancel(id);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const pending = transport.request(id, url);
    if (signal?.aborted) transport.cancel(id);
    const result = await pending;
    if (signal?.aborted) throw aborted();
    return {
      status: result.status,
      ok: result.status >= 200 && result.status < 300,
      headers: { get(name: string) {
        const key = name.toLowerCase();
        return key === 'retry-after' ? result.retryAfter : key === 'ratelimit-reset' ? result.rateLimitReset : null;
      } },
      json: async () => JSON.parse(result.body),
    } as Response;
  } catch (error) {
    if (signal?.aborted) throw aborted();
    throw error;
  } finally { signal?.removeEventListener('abort', onAbort); }
}
