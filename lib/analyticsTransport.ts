/** Volatile, bounded delivery of already-consented events. Never persisted. */
type Response = { status: number; headers: { get(name: string): string | null } };
type Request = { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal };
type Fetch = (url: string, init: Request) => Promise<Response>;
type Job = {
  url: string; body: string; authorization: number; created: number;
  attempt: number; running: boolean; timer?: ReturnType<typeof setTimeout>; controller?: AbortController;
};
type Options = { retryDelaysMs?: number[]; timeoutMs?: number; maxAgeMs?: number; maxPending?: number; maxConcurrent?: number };

export class AnalyticsTransport {
  private jobs = new Set<Job>();
  private running = 0;
  private options: Required<Options>;

  constructor(private fetcher: Fetch, private authorized: (token: number | null) => boolean, options: Options = {}) {
    this.options = { retryDelaysMs: [1000, 5000], timeoutMs: 8000, maxAgeMs: 60000, maxPending: 32, maxConcurrent: 2, ...options };
  }

  send(url: string, body: string, authorization: number | null): void {
    if (authorization === null || !this.authorized(authorization) || this.jobs.size >= this.options.maxPending) return;
    this.jobs.add({ url, body, authorization, created: Date.now(), attempt: 0, running: false });
    this.drain();
  }

  clear(): void {
    for (const job of this.jobs) {
      clearTimeout(job.timer);
      job.controller?.abort();
    }
    this.jobs.clear();
  }

  private current(job: Job): boolean {
    return this.jobs.has(job) && this.authorized(job.authorization) && Date.now() - job.created < this.options.maxAgeMs;
  }

  private drain(): void {
    for (const job of this.jobs) {
      if (this.running >= this.options.maxConcurrent) break;
      if (job.running || job.timer !== undefined) continue;
      if (!this.current(job)) { this.jobs.delete(job); continue; }
      void this.attempt(job);
    }
  }

  private async attempt(job: Job): Promise<void> {
    job.running = true;
    this.running++;
    const controller = new AbortController();
    job.controller = controller;
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('Analytics request cancelled')), { once: true });
    });
    const timeout = setTimeout(() => controller.abort(), Math.min(this.options.timeoutMs, this.options.maxAgeMs - (Date.now() - job.created)));
    let retry = false, retryAfter = 0;
    try {
      const response = await Promise.race([
        this.fetcher(job.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: job.body, signal: controller.signal }),
        aborted,
      ]);
      retry = response.status === 408 || response.status === 429 || response.status >= 500;
      if (retry) {
        const header = response.headers.get('Retry-After');
        if (header) {
          const seconds = Number(header);
          retryAfter = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(header) - Date.now());
          if (!Number.isFinite(retryAfter)) retryAfter = 0;
        }
      }
    } catch {
      retry = true;
    } finally {
      clearTimeout(timeout);
      job.controller = undefined;
      job.running = false;
      this.running--;
    }
    const delay = Math.max(this.options.retryDelaysMs[job.attempt] ?? 0, retryAfter);
    if (retry && this.current(job) && job.attempt < this.options.retryDelaysMs.length && Date.now() - job.created + delay < this.options.maxAgeMs) {
      job.attempt++;
      job.timer = setTimeout(() => { job.timer = undefined; this.drain(); }, delay);
    } else {
      this.jobs.delete(job);
    }
    this.drain();
  }
}
