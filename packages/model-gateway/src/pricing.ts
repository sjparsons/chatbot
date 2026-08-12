import type { TokenUsage } from "./types.js";

/** USD per million tokens. */
export interface ModelPricing {
  input: number;
  output: number;
  /** Writing a cache entry: 1.25x input at the 5-minute TTL (2x at one hour). */
  cacheWrite: number;
  /** Reading one back: 0.1x input. This is the whole point of caching. */
  cacheRead: number;
}

const perMillion = (input: number, output: number): ModelPricing => ({
  input,
  output,
  cacheWrite: input * 1.25,
  cacheRead: input * 0.1,
});

/**
 * List prices, keyed by model alias.
 *
 * Only the models this service can actually send a turn to — the primary and
 * the fallback. An unpriced model yields a null cost rather than a guess, and
 * the token columns are the source of truth either way: they are what the
 * provider billed on, so a wrong price here is recomputable and a wrong token
 * count is not.
 */
const PRICES: Record<string, ModelPricing> = {
  "claude-haiku-4-5": perMillion(1, 5),

  // Introductory pricing runs at $2/$10 until 2026-08-31, so logged cost
  // overstates actual spend on this model until then. Not modelled: a price
  // with an expiry date is a scheduled bug.
  "claude-sonnet-5": perMillion(3, 15),
};

/**
 * Prices a turn, in USD.
 *
 * Takes the model id from the *response*, which is dated
 * (`claude-haiku-4-5-20251001`), so the lookup matches on the alias prefix.
 * That is deliberate: a dated snapshot costs what its alias costs, and pinning
 * the table to dated ids would mean a price table change every model release.
 */
export function estimateCostUsd(
  model: string,
  usage: TokenUsage | null,
): number | null {
  if (!usage) return null;

  const pricing = findPricing(model);
  if (!pricing) return null;

  const million = 1_000_000;

  return (
    (usage.inputTokens * pricing.input +
      usage.outputTokens * pricing.output +
      usage.cacheCreationInputTokens * pricing.cacheWrite +
      usage.cacheReadInputTokens * pricing.cacheRead) /
    million
  );
}

function findPricing(model: string): ModelPricing | null {
  const exact = PRICES[model];
  if (exact) return exact;

  // Longest match wins, so a future `claude-haiku-4-5-2` alias could not be
  // silently priced by the shorter `claude-haiku-4-5` entry.
  const alias = Object.keys(PRICES)
    .filter((key) => model.startsWith(key))
    .sort((a, b) => b.length - a.length)
    .at(0);

  return alias ? (PRICES[alias] ?? null) : null;
}
