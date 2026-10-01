export type AnalyticsConsent = 'accepted' | 'refused' | 'undecided';
export type ExplicitAnalyticsConsent = Exclude<AnalyticsConsent, 'undecided'>;

export interface ConsentStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export class AnalyticsConsentState {
  private consent: AnalyticsConsent = 'undecided';
  private generation = 0;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: ConsentStorage,
    private readonly key = 'albion_analytics_consent',
  ) {}

  get(): AnalyticsConsent {
    return this.consent;
  }

  captureAuthorization(): number | null {
    return this.consent === 'accepted' ? this.generation : null;
  }

  isAuthorizationCurrent(generation: number | null): boolean {
    return generation !== null && this.consent === 'accepted' && generation === this.generation;
  }

  async initialize(): Promise<AnalyticsConsent> {
    const generation = this.generation;
    try {
      const stored = await this.storage.getItem(this.key);
      if (generation === this.generation) {
        this.consent = stored === 'accepted' || stored === 'refused' ? stored : 'undecided';
      }
    } catch {
      if (generation === this.generation) this.consent = 'undecided';
    }
    return this.consent;
  }

  async synchronizeFromStorage(): Promise<AnalyticsConsent> {
    const generation = ++this.generation;
    // A cross-tab change is fail-closed immediately, before any queued I/O.
    this.consent = 'undecided';
    await this.writeQueue.catch(() => undefined);
    try {
      const stored = await this.storage.getItem(this.key);
      if (generation === this.generation) {
        this.consent = stored === 'accepted' || stored === 'refused' ? stored : 'undecided';
      }
    } catch {
      if (generation === this.generation) this.consent = 'undecided';
    }
    return this.consent;
  }

  async set(choice: ExplicitAnalyticsConsent): Promise<void> {
    if (choice !== 'accepted' && choice !== 'refused') throw new Error('invalid analytics consent');
    const generation = ++this.generation;
    if (choice === 'refused') this.consent = 'refused';

    const write = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        if (choice === 'accepted') {
          await this.storage.setItem(this.key, 'accepted');
          return;
        }
        try {
          await this.storage.setItem(this.key, 'refused');
        } catch (writeError) {
          try {
            // Removing a stale acceptance is a safe persisted undecided state.
            await this.storage.removeItem(this.key);
          } catch (removeError) {
            throw new AggregateError([writeError, removeError], 'analytics refusal could not be persisted');
          }
        }
      });
    this.writeQueue = write.catch(() => undefined);
    try {
      await write;
    } catch (error) {
      if (generation === this.generation && choice === 'refused') {
        // Persistence is unavailable and a stale acceptance may remain on disk.
        // Keep transport disabled and force the prompt to remain visible.
        this.consent = 'undecided';
      }
      throw error;
    }

    if (generation !== this.generation) return;
    if (choice === 'accepted') this.consent = 'accepted';
  }
}
