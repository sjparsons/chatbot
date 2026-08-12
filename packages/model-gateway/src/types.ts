/**
 * A message as the model sees it. Deliberately the shape the provider APIs
 * take, so an assembled context passes through without translating.
 */
export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  /**
   * Cancels the in-flight provider call. chat-api wires this to the client
   * disconnecting, so an abandoned turn stops costing money mid-flight.
   */
  signal?: AbortSignal;
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
