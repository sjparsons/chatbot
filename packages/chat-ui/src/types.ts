export type Role = "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  content: string;
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** First thing the user said — null for a session with no turns yet. */
  preview: string | null;
  turnCount: number;
}
