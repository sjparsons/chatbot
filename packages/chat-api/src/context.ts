import type { TurnRow } from "./db/repository.js";

/**
 * A message as the model sees it. Deliberately the shape the provider APIs
 * take, so the gateway can pass this array through without translating.
 */
export interface Message {
  role: "user" | "assistant";
  content: string;
}

/**
 * Flattens a session transcript into the model's message array.
 *
 * The turn being answered is expected to be last, with no response yet — it
 * contributes the trailing user message.
 *
 * Earlier turns that never got a successful reply are dropped whole rather
 * than contributing a lone user message. That keeps roles strictly
 * alternating, which is what the provider APIs expect, and an unanswered turn
 * is not something the model ever said.
 */
export function buildContext(turns: TurnRow[]): Message[] {
  const messages: Message[] = [];

  turns.forEach((turn, index) => {
    const response = turn.response;
    const reply =
      response && response.status === "ok" && response.content
        ? response.content
        : null;

    const isCurrentTurn = index === turns.length - 1;
    if (!reply && !isCurrentTurn) return;

    messages.push({ role: "user", content: turn.request.content });
    if (reply) messages.push({ role: "assistant", content: reply });
  });

  return messages;
}
