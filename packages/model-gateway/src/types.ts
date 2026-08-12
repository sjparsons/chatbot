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
}

/**
 * What chat-api calls instead of a model client.
 *
 * `generate` is an async generator so that real token streaming is a change
 * inside the gateway rather than to the transport or the UI. Today every
 * provider yields the whole reply as a single chunk.
 */
export interface Gateway {
  generate(
    messages: Message[],
    options?: GenerateOptions,
  ): AsyncGenerator<string>;
}
