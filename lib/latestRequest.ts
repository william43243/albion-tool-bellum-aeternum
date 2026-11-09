interface RequestHandlers<T> {
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
  onLoadingChange: (loading: boolean) => void;
}

/** Only the latest request in the current filter scope may update the UI. */
export function createLatestRequestScope() {
  let generation = 0;
  return {
    invalidate() { generation += 1; },
    async run<T>(load: (isCurrent: () => boolean) => Promise<T>, handlers: RequestHandlers<T>): Promise<void> {
      const request = ++generation;
      const isCurrent = () => request === generation;
      handlers.onLoadingChange(true);
      try {
        const value = await load(isCurrent);
        if (isCurrent()) handlers.onSuccess(value);
      } catch (error) {
        if (isCurrent()) handlers.onError(error);
      } finally {
        // An older completion must not stop the spinner for a newer request.
        if (isCurrent()) handlers.onLoadingChange(false);
      }
    },
  };
}
