/** Session identity for asynchronous UI, market requests and native callbacks.
 * Native lifecycle operations are serialized, but stale results never become ready. */
export function createAdvisorSession(initialServer: string) {
  let server = initialServer;
  let generation = 0;
  let readyGeneration: number | null = null;
  let serverChangePending = false;
  let mounted = true;
  let request = 0;
  let stream = 0;
  let activeStream: number | null = null;
  let lifecycle: Promise<unknown> = Promise.resolve();

  const invalidate = () => {
    generation += 1;
    request += 1;
    readyGeneration = null;
    activeStream = null;
    return generation;
  };
  const isCurrent = (session: number) => mounted && session === generation;
  const isReady = (session: number) => isCurrent(session) && readyGeneration === session;

  return {
    // Called during render so an old promise cannot win before effects run.
    configure(nextServer: string) {
      if (server !== nextServer) { server = nextServer; serverChangePending = true; invalidate(); }
    },
    hasServerChange: () => serverChangePending,
    acknowledgeServerChange: () => { serverChangePending = false; },
    matchesServer: (expected: string) => mounted && server === expected,
    capture: () => generation,
    isCurrent,
    isReady,
    invalidate,
    suspend: () => { readyGeneration = null; },
    markReady(session: number) { if (isCurrent(session)) readyGeneration = session; },
    mount: () => { mounted = true; },
    dispose: () => { mounted = false; invalidate(); },
    beginRequest: () => ({ session: generation, request: ++request }),
    captureRequest: () => ({ session: generation, request }),
    isRequestCurrent: (ticket: { session: number; request: number }) =>
      isCurrent(ticket.session) && ticket.request === request,
    beginStream(session: number) {
      if (!isReady(session) || activeStream !== null) return null;
      activeStream = ++stream;
      return { session, stream };
    },
    isStreamCurrent: (ticket: { session: number; stream: number }) =>
      isCurrent(ticket.session) && ticket.stream === activeStream,
    endStream(ticket: { session: number; stream: number }) {
      if (isCurrent(ticket.session) && ticket.stream === activeStream) activeStream = null;
    },
    isStreaming: () => activeStream !== null,
    captureStream: () => activeStream === null ? null : { session: generation, stream: activeStream },
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const pending = lifecycle.then(operation, operation);
      lifecycle = pending.catch(() => {});
      return pending;
    },
  };
}
