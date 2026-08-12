import { API_URL } from "./config";
import type { Message, SessionSummary } from "../types";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`);

  if (!response.ok) {
    throw new Error(`chat-api responded ${response.status}`);
  }

  return (await response.json()) as T;
}

/** Session history for the sidebar, newest first. */
export async function listSessions(): Promise<SessionSummary[]> {
  const body = await getJson<{ sessions: SessionSummary[] }>("/sessions");
  return body.sessions;
}

/** The stored transcript, for rehydrating a session the user jumps back into. */
export async function fetchMessages(sessionId: string): Promise<Message[]> {
  const body = await getJson<{ messages: Message[] }>(
    `/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  return body.messages;
}
