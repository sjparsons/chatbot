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
