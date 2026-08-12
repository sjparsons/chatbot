/**
 * A message as the model sees it. Deliberately the shape the provider APIs
 * take, so an assembled context passes through without translating.
 */
export interface Message {
  role: "user" | "assistant";
  content: string;
}

/**
 * The system prompt for one turn, with the id of the artifact it came from.
 *
 * Text and version travel together deliberately: a version that can be logged
 * without the text it labels is a version that can drift from it.
 */
export interface SystemPrompt {
  /** Identifies exactly this text. Derived from it, so it cannot lag behind. */
  version: string;
  text: string;
}

/**
 * The four token counts the provider bills on. They price differently —
 * a cache read is a tenth of a fresh input token — so cost needs all four,
 * not just input and output.
 *
 * The cache fields are 0 until there is a cache breakpoint to hit.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/** What a turn cost and what produced it. */
export interface TurnMetadata {
  /**
   * The dated id from the response (`claude-haiku-4-5-20251001`), not the
   * alias that was sent. The alias moves; provenance that moves with it is
   * worthless.
   */
  model: string;
  stopReason: string | null;
  /**
   * The provider's `request-id` header. It is what provider support asks for,
   * and nothing else identifies the call.
   */
  providerRequestId: string | null;
  usage: TokenUsage | null;
  /** Estimated from `usage` and a local price table. Null if unpriced. */
  costUsd: number | null;
}

export interface GenerateOptions {
  /**
   * Cancels the in-flight provider call. chat-api wires this to the client
   * disconnecting, so an abandoned turn stops costing money mid-flight.
   */
  signal?: AbortSignal;

  /**
   * A per-call argument, not gateway config: the assistant's instructions are
   * the caller's business, and later steps send different prompts to different
   * models through the same gateway.
   */
  system?: SystemPrompt;

  /**
   * Called once per completed provider call, before `generate` yields anything.
   *
   * A callback rather than the generator's return value because the turn log
   * exists for the turns that go wrong: a caller that breaks out of the loop on
   * an abort, or catches a refusal, never sees a return value, but has already
   * been handed the metadata here. Fallback calls it twice — last one wins,
   * and that is the call that produced the reply.
   */
  onMetadata?: (metadata: TurnMetadata) => void;
}

/**
 * What chat-api calls instead of a model client.
 *
 * `generate` is an async generator, which is what let real token streaming land
 * inside the gateway without touching the transport or the UI. Both providers
 * now yield many chunks; a consumer must not assume one.
 */
export interface Gateway {
  generate(
    messages: Message[],
    options?: GenerateOptions,
  ): AsyncGenerator<string>;
}
