import type { Logger } from "@chatbot/model-gateway";

/**
 * What the judging cost. Not what the run cost.
 *
 * The assistant's own inference happens inside chat-api, which reports neither
 * tokens on the `done` event nor token columns in `responses` — that is step 5.
 * So this covers the calls this process makes and nothing else, and the label
 * says so wherever the number is printed.
 */
export interface JudgeUsage {
  /** The model that actually answered, read off the response rather than config. */
  model: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/** USD per million tokens, input and output. */
const RATES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/**
 * A rate table in the repo goes stale silently, which is the failure mode the
 * derived prompt version exists to avoid elsewhere. So an unpriced model scores
 * `null` rather than 0: a missing cost is visible in the results line, a wrong
 * one is not. The token counts are the durable fact and are recorded either
 * way, so any line can be repriced later.
 */
export function costUsd(usage: JudgeUsage): number | null {
  const rate = usage.model === null ? undefined : RATES[usage.model];
  if (rate === undefined) return null;

  const dollars =
    (usage.inputTokens * rate.input + usage.outputTokens * rate.output) / 1e6;

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
