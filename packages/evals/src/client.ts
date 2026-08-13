/**
 * The eval harness's view of chat-api: a server someone else started.
 *
 * Scoring the real endpoint rather than the gateway is the point — guardrails,
 * context assembly and, later, tools all sit between HTTP and the model, and a
 * baseline taken below them would miss every regression they introduce.
 */

/** What `GET /health` reports about the process under test. */
export interface Health {
  status: string;
  prompt: string;
  model: string;
}

export interface Turn {
  sessionId: string;
  reply: string;
}

export async function fetchHealth(baseUrl: string): Promise<Health> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/health`);
  } catch (cause) {
    throw new Error(
      `cannot reach chat-api at ${baseUrl}. Start it with \`npm run dev\`, ` +
        `or point EVAL_BASE_URL somewhere else.`,
      { cause },
    );
  }

  if (!response.ok) throw new Error(`${baseUrl}/health returned ${response.status}`);

  const health = (await response.json()) as Partial<Health>;

  // An older chat-api answers /health without these. Failing here beats
  // writing a results line that cannot name the prompt it scored.
  if (!health.prompt || !health.model) {
    throw new Error(
      `${baseUrl}/health did not report a prompt version and model id. ` +
        `That chat-api predates the eval harness.`,
    );
  }

  return { status: health.status ?? "unknown", prompt: health.prompt, model: health.model };
}

/**
 * Posts one user message and reads the SSE stream to completion.
 *
 * Reads the whole body before parsing. Streaming incrementally would buy
 * nothing here: the score is computed on the finished reply.
 */
async function postTurn(
  baseUrl: string,
  content: string,
  sessionId: string | null,
): Promise<Turn> {
  const response = await fetch(`${baseUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ content, sessionId }),
  });

  if (!response.ok) {
    throw new Error(`POST /chat returned ${response.status}: ${await response.text()}`);
  }

  let session = sessionId;
  let reply = "";

  for (const block of (await response.text()).split("\n\n")) {
    if (!block.trim()) continue;

    const lines = block.split("\n");
    const event = lines.find((l) => l.startsWith("event: "))?.slice(7);
    const raw = lines.find((l) => l.startsWith("data: "))?.slice(6);
    if (!event || !raw) continue;

    const data = JSON.parse(raw) as Record<string, unknown>;

    if (event === "start" && typeof data.sessionId === "string") session = data.sessionId;
    if (event === "delta" && typeof data.text === "string") reply += data.text;
    // A turn that failed has no reply to score, and scoring "" would look like
    // a model that said nothing rather than a run that broke.
    if (event === "error") throw new Error(`chat-api returned an error event: ${data.message}`);
  }

  if (!session) throw new Error("no session id in the stream");

  return { sessionId: session, reply };
}

/**
 * Plays a case's turns against one session and returns the last reply.
 *
 * Earlier turns are answered by the model for real rather than being scripted,
 * so a case like "customer pushes back" lands against what the assistant
 * actually said. The cost is that the setup varies between runs; the benefit
 * is that it is a conversation rather than a fixture.
 */
export async function runTurns(baseUrl: string, turns: string[]): Promise<Turn> {
  let sessionId: string | null = null;
  let reply = "";

  for (const content of turns) {
    const turn = await postTurn(baseUrl, content, sessionId);
    sessionId = turn.sessionId;
    reply = turn.reply;
  }

  if (!sessionId) throw new Error("a case must have at least one turn");

  return { sessionId, reply };
}
