import { estimateCostUsd, type Logger } from "@chatbot/model-gateway";

/**
 * What the judging cost. Not what the run cost.
 *
 * The assistant's own inference happens inside chat-api, which now records its
 * own tokens and cost per turn in `responses` — but nothing reports them back
 * over the wire, and this process only ever sees HTTP. So this covers the calls
 * it makes itself and nothing else, and the label says so wherever the number
 * is printed. Joining the two means querying the turn log by prompt version.
 */
export interface JudgeUsage {
  /** The model that actually answered, read off the response rather than config. */
  model: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Prices a run's judging from the gateway's table.
 *
 * The rates live in `@chatbot/model-gateway`, not here. Two tables of the same
 * numbers is the staleness failure this file's own rule was written against —
 * and the halves drift in ways that are hard to see: one would price a dated
 * model id and the other score it `null`. The gateway owns model config, and
 * both callers already depend on it, so it owns what a model costs.
 *
 * An unpriced model still scores `null` rather than 0: a missing cost is
 * visible in the results line and a wrong one is not. The token counts are the
 * durable fact and are recorded either way, so any line can be repriced later.
 */
export function costUsd(usage: JudgeUsage): number | null {
  if (usage.model === null) return null;

  const dollars = estimateCostUsd(usage.model, {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    // Judging sets no cache breakpoint, so these are zero rather than unknown.
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  });

  if (dollars === null) return null;

  // Six places because a run costs about a cent, and rounding to four would
  // report most of them as 0.01 regardless of what changed.
  return Number(dollars.toFixed(6));
}

export function createUsageTally(): { usage: JudgeUsage; logger: Logger } {
  const usage: JudgeUsage = {
    model: null,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
  };

  const logger: Logger = (event) => {
    if (event.direction !== "response") return;

    usage.model = event.model;
    usage.calls += 1;

    // The mock reports no usage. Counting the call but not the tokens keeps the
    // call count honest rather than making a keyless run look free.
    if (event.usage === null) return;
    usage.inputTokens += event.usage.inputTokens;
    usage.outputTokens += event.usage.outputTokens;
  };

  return { usage, logger };
}
