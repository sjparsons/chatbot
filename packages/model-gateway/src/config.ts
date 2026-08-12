export type ProviderName = "anthropic" | "mock";

export interface GatewayConfig {
  provider: ProviderName;
  /** Model the turn is sent to. */
  model: string;
  /** Tried once if `model` fails retryably. `null` disables the fallback. */
  fallbackModel: string | null;
  maxTokens: number;
  /** Wall clock for a single provider call, in milliseconds. */
  timeoutMs: number;
  /** Attempts the SDK makes per call before giving up. */
  maxRetries: number;
  apiKey: string | undefined;
  /** The SDK's other credential. Either this or `apiKey` will do. */
  authToken: string | undefined;
  /** Print the message array sent and the text returned, per turn. */
  logPayloads: boolean;
  mockDelayMinMs: number;
  mockDelayMaxMs: number;
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Read at call time rather than module load, so tests and callers can override
 * without reaching for module mocks.
 */
export function loadConfig(
  overrides: Partial<GatewayConfig> = {},
  env: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  const fallbackModel = str(env.MODEL_FALLBACK_ID, "claude-sonnet-5");

  return {
    provider: env.MODEL_PROVIDER === "mock" ? "mock" : "anthropic",

    // Haiku while the shape is being proved out — cheapest model that is still
    // a real one. Note it does NOT accept the `effort` parameter.
    model: str(env.MODEL_ID, "claude-haiku-4-5"),

    // Only reached after the SDK has exhausted its own retries, so it is the
    // last thing between a provider blip and a failed turn. "none" disables it.
    fallbackModel: fallbackModel === "none" ? null : fallbackModel,

    // A chat reply is a deliberately short output; this is a ceiling to stop a
    // runaway response, not a target. Raise it before asking for long output.
    maxTokens: int(env.MODEL_MAX_TOKENS, 4096),

    // The SDK defaults to 10 minutes, which would hold an SSE stream open far
    // longer than anyone waits. 60s is well past a normal Haiku turn.
    timeoutMs: int(env.MODEL_TIMEOUT_MS, 60_000),

    // The SDK's own backoff, which honours `retry-after` on a 429. Hand-rolling
    // a second layer on top of it would just multiply the wait.
    maxRetries: int(env.MODEL_MAX_RETRIES, 2),

    apiKey: env.ANTHROPIC_API_KEY,
    authToken: env.ANTHROPIC_AUTH_TOKEN,

    // On by default: while there is no prompt artifact and no token columns in
    // the turn log, stdout is the only way to see what the model was given.
    logPayloads: env.MODEL_LOG_PAYLOADS !== "0",

    mockDelayMinMs: int(env.MOCK_DELAY_MIN_MS, 500),
    mockDelayMaxMs: int(env.MOCK_DELAY_MAX_MS, 3000),

    ...overrides,
  };
}
