import { config } from "./config.js";
import type { Message } from "./context.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stand-in for the model call.
 *
 * Takes the assembled context rather than the latest message, because that is
 * what a model takes — swapping in a provider client shouldn't change the
 * route. The reply echoes the previous turn so that "did it see turn 1 when
 * answering turn 2" is answerable without a real model.
 *
 * Yields chunks so the transport is exercised the way real token streaming
 * will use it — today that is one chunk after a delay, later it will be many.
 */
export async function* generateResponse(
  messages: Message[],
): AsyncGenerator<string> {
  const { mockDelayMinMs, mockDelayMaxMs } = config;
  const span = Math.max(0, mockDelayMaxMs - mockDelayMinMs);

  await sleep(mockDelayMinMs + Math.random() * span);

  const previousUserMessage = messages
    .slice(0, -1)
    .filter((message) => message.role === "user")
    .at(-1);

  if (!previousUserMessage) {
    yield "RESPONSE";
    return;
  }

  yield `RESPONSE (${messages.length} messages in context, previous: "${previousUserMessage.content}")`;
}
