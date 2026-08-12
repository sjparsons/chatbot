-- Every turn is recorded here. This is the observability substrate: the
-- transcript of record, independent of whatever the model sees in its context
-- window.

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requests_session
  ON requests(session_id, created_at);

CREATE TABLE IF NOT EXISTS responses (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  -- 'ok' once the stream completes, 'error' if it failed partway
  status      TEXT NOT NULL,
  error       TEXT,
  latency_ms  INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_responses_session
  ON responses(session_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_responses_request
  ON responses(request_id);
