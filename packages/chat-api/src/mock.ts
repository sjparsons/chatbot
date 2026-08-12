import { config } from "./config.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stand-in for the model call.
 *
 * Yields chunks so the transport is exercised the way real token streaming
 * will use it — today that is one chunk after a delay, later it will be many.
 * Replacing this generator is the only change the route needs.
 */
export async function* generateResponse(_content: string): AsyncGenerator<string> {
  const { mockDelayMinMs, mockDelayMaxMs } = config;
  const span = Math.max(0, mockDelayMaxMs - mockDelayMinMs);

  await sleep(mockDelayMinMs + Math.random() * span);

  yield "RESPONSE";
}
