/**
 * Product analytics are intentionally disabled.
 *
 * Keep these no-op exports while call sites are removed incrementally. They
 * preserve UI behavior without creating any network request or persistent
 * identifier on Android, iOS, or web.
 */

export function trackPageView(_page: string): void {}
export function trackToolUse(_toolName: string): void {}
export function trackAIPrompt(_modelId: string): void {}
export function trackAIModelDownload(_modelId: string): void {}
export function trackAIModelStart(_modelId: string): void {}
export function trackAIImageSent(_modelId: string): void {}
export function trackFlipCalculation(): void {}
export function trackMarketCalculation(): void {}
export function trackCraftCalculation(): void {}
export function trackPriceFetch(_itemId: string, _city: string): void {}
export function trackHistoryFetch(_itemId: string): void {}
export function trackEvent(
  _name: string,
  _category?: string,
  _metadata?: Record<string, unknown>,
): void {}
