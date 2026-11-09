# Marketplace price-side audit

Verified on 2026-11-05. This note separates observed API facts from calculator assumptions.

## Sources checked

- [AODP API entry page](https://www.albion-online-data.com/api/): separate Americas, Europe, and Asia hosts; location names/IDs; item IDs.
- [Live Americas Swagger document](https://west.albion-online-data.com/api/v2/swagger_doc): `/prices/{id}` accepts item IDs, locations, and quality levels 1–5. `/orderbook/{id}` lists sell orders cheapest first and buy orders richest first.
- [AODP homepage](https://www.albion-online-data.com/): contributors upload only the market orders they load in the game. Uploads appear immediately, but that does not guarantee complete or up-to-date market coverage.
- Official server source, pinned to commit `dfc8227d88a2dfe352442b7dc6a1f6ffed05d3a0`:
  - [market_data_service.rb](https://github.com/ao-data/albiondata-server-rails/blob/dfc8227d88a2dfe352442b7dc6a1f6ffed05d3a0/app/services/market_data_service.rb): MIN/MAX are grouped by auction type. Offers populate sell fields; requests populate buy fields. Each side uses its latest five-minute observation bin within the last day, not a guaranteed complete executable order book.
  - [market_order_dedupe_service.rb](https://github.com/ao-data/albiondata-server-rails/blob/dfc8227d88a2dfe352442b7dc6a1f6ffed05d3a0/app/services/market_order_dedupe_service.rb): the protocol's silver-unit scaling is normalized on the server. REST price values are already unit prices in silver; do not divide them by 10,000 again.
  - [market_orderbook_service.rb](https://github.com/ao-data/albiondata-server-rails/blob/dfc8227d88a2dfe352442b7dc6a1f6ffed05d3a0/app/services/market_orderbook_service.rb): ascending sell and descending buy order sorting corroborates the price-side semantics.

## Correct calculator interpretation

| User action | Reference field | Matching timestamp |
| --- | --- | --- |
| Instant purchase | `sell_price_min` (lowest observed ask) | `sell_price_min_date` |
| Create buy order | `buy_price_max` (highest observed bid) | `buy_price_max_date` |
| Instant sale | `buy_price_max` (highest observed bid) | `buy_price_max_date` |
| Create sell order | `sell_price_min` (lowest observed ask) | `sell_price_min_date` |

Using the existing best bid/ask as a new order's target is a calculator assumption. It does not imply that the new order will execute, receive queue priority, or fill the requested quantity. The `/prices` response provides no order depth. A missing side must remain empty rather than borrowing the opposite side. Zero values with a year-0001 date mean no observation, not a free tradable item.

Keep the source date with the price selected, even when switching modes. The two sides can be hours apart. The real response below uses timestamps without a timezone suffix. Server UTC conventions corroborate treating them as UTC; their shape alone does not prove UTC. Timestamp parsing is handled separately by `aodpTime.ts`, not by this mapping fix. The 30-minute application cache remains the default for ordinary queries. The explicit “live” button now bypasses it, but a new response still does not guarantee a newer market observation.

## Reproduced wrong result

Request executed at approximately 02:43 UTC:

`https://west.albion-online-data.com/api/v2/stats/prices/T4_BAG.json?locations=Martlock&qualities=1`

```json
[{"item_id":"T4_BAG","city":"Martlock","quality":1,"sell_price_min":6973,"sell_price_min_date":"2026-11-05T02:20:00","sell_price_max":6979,"sell_price_max_date":"2026-11-05T02:20:00","buy_price_min":3,"buy_price_min_date":"2026-11-05T00:35:00","buy_price_max":3000,"buy_price_max_date":"2026-11-05T00:35:00"}]
```

With Premium, quantity 1, and both order toggles off:

- Before: purchase 3,000, sale 6,973, tax 279, displayed profit **+3,694**.
- Correct side selection: purchase 6,973, sale 3,000, tax 120, displayed loss **−4,093**.

This is a deterministic arithmetic regression using the observed quote, not a claim that either price is presently executable.

## Request and UI safeguards

- Store the raw quote, then resolve each side using the current independent order toggles. Mode changes also update source timestamps and each strategy-comparison row. Reject non-positive/non-finite prices and absent, invalid, or year-0001 timestamps through the API's shared observation validator.
- Preserve explicit manual inputs across mode changes. Remove their API observation timestamps, which no longer describe those inputs.
- Invalidate pending price requests on quality, city, server, or unmount. Stale success, error, and loading callbacks cannot change the new scope.
- Separately invalidate watchlist scans when the server or watchlist contents change. Stop subsequent batches when obsolete and do not apply stale partial batches.
- Watchlist coverage counts distinct cities with at least one valid bid or ask and its matching source timestamp. AODP placeholder rows with zero prices/year-0001 dates count as zero, not seven available cities. The label says “cities with data”; it does not claim freshness or execution. An unreturned/failed batch remains distinguishable from a successful response containing no observations.
- Clear the previous quote when a new item request begins, so an empty/error response does not leave another item's prices looking current.
- Explicit Marketplace refresh uses `forceRefresh: true`, makes a browser-cache-bypassing request, and replaces the application cache only after success. Identical concurrent requests share one fresh network request. Failed refreshes remain visible errors, not silently substituted cached successes. Server-provided market timestamps are never replaced by the refresh time.

## API usage limits observed in the live docs

The live Swagger document specifies 100 requests per minute and 300 per five minutes per IP. Requests without an accepted compression encoding are restricted to one per five minutes. On HTTP 429, wait for `RateLimit-Reset`; repeated requests can trigger a temporary firewall ban. Batch item/location queries and keep URLs under 4,096 characters.

The current-price fetcher now blocks further network requests to the limited game server until the later valid `RateLimit-Reset` (Unix seconds) or `Retry-After` deadline. If neither header gives a future deadline, it waits five minutes. There is no automatic retry. Other servers are unaffected. The browser/native networking platform supplies compression headers; browser JavaScript must not set the forbidden `Accept-Encoding` header. Existing Live polling and batch transport remain separate and unchanged.

## Validation

Regression coverage is in `tests/marketplacePrices.test.ts`, `tests/latestRequest.test.ts`, and `tests/currentPriceRefresh.test.ts`: all four independent strategies, source dates, observed loss example, mode changes, partial/manual/empty inputs, missing or invalid quote sides, outdated responses/errors/loading, cancellation between scan batches, explicit refresh/cache replacement, failures, concurrent request coalescing, and 429 cooldowns. API refresh tests use a mocked fetch and clock only, with no external stress traffic. Static wiring assertions complement the behavioral helper tests; they are not a substitute for an end-to-end React Native/device run.

`tests/watchlistPrices.test.ts` additionally reproduces a seven-city response containing only placeholders and checks unique-city coverage, invalid side/date combinations, separate bid/ask dates, and item/quality isolation.

## Latent strategy helper

`marketOpportunity.evaluateOpportunity` previously always used the source ask and destination bid, changing only fees for the four modes. This helper is not currently called by the app UI. It now selects the appropriate side for each strategy, with that side's own date and missing-observation validation. `evaluateAllStrategies` inherits the fix. With source ask/bid 100/80, destination ask/bid 100/200, quantity 10, and Premium, instant-order changes from an erroneous +87 silver/unit to −6.5. Regression tests cover all four price/date combinations and missing required sides. The helper remains a scenario estimator, not an execution guarantee.
