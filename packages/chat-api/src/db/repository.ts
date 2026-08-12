import { randomUUID } from "node:crypto";
import type { Db } from "./index.js";

export interface SessionRow {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface RequestRow {
  id: string;
  session_id: string;
  content: string;
  created_at: string;
}

export interface ResponseRow {
  id: string;
  request_id: string;
  session_id: string;
  content: string;
  status: "ok" | "error";
  error: string | null;
  latency_ms: number;
  created_at: string;
}

export interface TurnRow {
  request: RequestRow;
  response: ResponseRow | null;
}

const now = () => new Date().toISOString();

/**
 * All SQL lives here. Everything above this layer works in terms of these
 * methods, so moving to Postgres later is confined to this file.
 */
export class Repository {
  constructor(private readonly db: Db) {}

  createSession(): SessionRow {
    const row: SessionRow = {
      id: randomUUID(),
      created_at: now(),
      updated_at: now(),
    };

    this.db
      .prepare(
        `INSERT INTO sessions (id, created_at, updated_at)
         VALUES (@id, @created_at, @updated_at)`,
      )
      .run(row);

    return row;
  }

  getSession(id: string): SessionRow | null {
    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(id) as SessionRow | undefined;

    return row ?? null;
  }

  /** Returns the existing session, or creates one if the id is absent/unknown. */
  ensureSession(id: string | null | undefined): SessionRow {
    if (!id) return this.createSession();
    return this.getSession(id) ?? this.createSession();
  }

  touchSession(id: string): void {
    this.db
      .prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`)
      .run(now(), id);
  }

  createRequest(sessionId: string, content: string): RequestRow {
    const row: RequestRow = {
      id: randomUUID(),
      session_id: sessionId,
      content,
      created_at: now(),
    };

    this.db
      .prepare(
        `INSERT INTO requests (id, session_id, content, created_at)
         VALUES (@id, @session_id, @content, @created_at)`,
      )
      .run(row);

    return row;
  }

  createResponse(input: {
    requestId: string;
    sessionId: string;
    content: string;
    status: "ok" | "error";
    error?: string | null;
    latencyMs: number;
  }): ResponseRow {
    const row: ResponseRow = {
      id: randomUUID(),
      request_id: input.requestId,
      session_id: input.sessionId,
      content: input.content,
      status: input.status,
      error: input.error ?? null,
      latency_ms: input.latencyMs,
      created_at: now(),
    };

    this.db
      .prepare(
        `INSERT INTO responses
           (id, request_id, session_id, content, status, error, latency_ms, created_at)
         VALUES
           (@id, @request_id, @session_id, @content, @status, @error, @latency_ms, @created_at)`,
      )
      .run(row);

    this.touchSession(input.sessionId);

    return row;
  }

  /** Full transcript for a session, oldest first. */
  listTurns(sessionId: string): TurnRow[] {
    const requests = this.db
      .prepare(
        `SELECT * FROM requests WHERE session_id = ? ORDER BY created_at, id`,
      )
      .all(sessionId) as RequestRow[];

    const responses = this.db
      .prepare(`SELECT * FROM responses WHERE session_id = ?`)
      .all(sessionId) as ResponseRow[];

    const byRequestId = new Map(responses.map((r) => [r.request_id, r]));

    return requests.map((request) => ({
      request,
      response: byRequestId.get(request.id) ?? null,
    }));
  }
}
