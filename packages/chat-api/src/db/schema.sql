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

-- Provenance and cost columns are all nullable: a turn that failed before the
-- provider answered has nothing to put in them, and that is a real state
-- rather than a zero.
CREATE TABLE IF NOT EXISTS responses (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  -- 'ok' once the stream completes, 'error' if it failed partway
  status      TEXT NOT NULL,
  error       TEXT,
  latency_ms  INTEGER NOT NULL,
  created_at  TEXT NOT NULL,

  -- The dated id from the response ('claude-haiku-4-5-20251001'), not the
  -- alias that was sent. Attributing a regression to a model means naming the
  -- exact one; an alias points at whatever is current, including now.
  model               TEXT,
  -- Hash of the system prompt text this turn ran under.
  prompt_version      TEXT,
  -- Provider's request-id header. What provider support asks for.
  provider_request_id TEXT,
  -- Provider's stop_reason: end_turn, max_tokens, refusal, tool_use.
  stop_reason         TEXT,

  -- Four counts, not two: cache writes and reads price differently from fresh
  -- input, so cost needs all four. The cache columns are 0 until there is a
  -- cache breakpoint (step 13) to hit.
  input_tokens                INTEGER,
  output_tokens               INTEGER,
  cache_creation_input_tokens INTEGER,
  cache_read_input_tokens     INTEGER,

  -- Estimated at write time from the token counts and a local price table.
  -- Stored alongside the tokens rather than derived on read, so a later price
  -- change does not silently rewrite what past turns cost — and recomputable
  -- from the tokens if the estimate was ever wrong.
  cost_usd    REAL
);

CREATE INDEX IF NOT EXISTS idx_responses_session
  ON responses(session_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_responses_request
  ON responses(request_id);
