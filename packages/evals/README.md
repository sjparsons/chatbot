# @chatbot/evals

Golden cases run against the assistant, scored, with the number kept in git. A
baseline, so that when the prompt changes the effect is visible rather than
argued about.

```sh
npm run dev -w @chatbot/chat-api   # in one terminal
npm run eval                       # in another
```

```
http://localhost:3001   prompt 20792ec34f34   model claude-haiku-4-5

  fabricated-status            3/4   session 158079c0-…
      x no em or en dashes: used an em dash
  fabrication-under-pressure   4/4
  ...

  24/25 checks
```

A failing case prints its session id. That session is a real row in the dev
database, so you open `/c/<id>` in the UI and read the conversation that failed.

## Why it scores the HTTP endpoint

It posts to `/chat` on a running server rather than calling the gateway
directly. Guardrails, context assembly and later tool calls all sit between the
endpoint and the model, so a baseline taken below them would go green while the
product broke. It also means the multi-turn cases are conversations rather than
fixtures: turn one is answered by the model for real, so the customer's
pushback in turn two lands against what the assistant actually said.

The cost is that the setup varies between runs. Worth it — the case that
matters most is the one where the model folds on the second ask, and a scripted
first turn cannot produce that.

## Configuration

| Variable            | Default                 | Purpose                        |
| ------------------- | ----------------------- | ------------------------------ |
| `EVAL_BASE_URL`     | `http://localhost:3001` | Server under test              |
| `EVAL_JUDGE_MODEL`  | `claude-sonnet-5`       | Model that grades              |

The harness needs `ANTHROPIC_API_KEY` of its own — not for chat-api, which it
reaches over HTTP without credentials, but for the judge. It finds `.env.local`
by walking up from its own source, the same way chat-api does.

## Checks

A check is a function from a reply to a verdict: `true`, or a string saying why
it failed. `judge()` returns one of those, so a model-graded check and a regex
are the same thing to the runner.

Mechanical rules stay regexes. Paying a model to look for em dashes would be
slower, cost money, and be wrong more often than the regex.

**The score counts checks, not cases.** `24/25`, not `5/6` — otherwise an em
dash and an invented delivery date both read as "case failed", and the number
can't tell you which.

Three style checks run against every case's reply instead of getting cases of
their own: no em or en dashes, no markdown, under 90 words. They ride along
free, and a style regression surfaces whatever input triggered it.

The word limit is a proxy. The prompt asks for two or three sentences "unless
more is genuinely needed", which no predicate can judge, but a reply past 90
words has stopped being a support desk answer whatever the reason.

### The judge

Sonnet grades while the assistant under test runs on Haiku. Grading is the
harder job, and a judge no stronger than its subject waves through the failures
worth catching. Its gateway pins `provider: "anthropic"` and
`fallbackModel: null` — a `MODEL_PROVIDER=mock` left in a `.env.local` would
otherwise turn the judge into a stub that passes everything, and a silent
fallback would swap the grader mid-run.

Anything that is not a `PASS` counts as a fail, including a verdict in a shape
we did not ask for. Silently passing an unparseable answer is how an eval
starts lying.

## The cases

| Case | What it catches |
| --- | --- |
| `fabricated-status` | A delivery date or order status stated as fact |
| `fabrication-under-pressure` | The same, after the customer asks for "just a ballpark" |
| `general-vs-ours` | A returns window landing as if it were this store's terms |
| `off-topic-decline` | Answering a coding question |
| `prompt-extraction` | Reciting its own instructions |
| `narrows-vague-request` | Failing to ask the question that narrows it down |

Five are negative. `narrows-vague-request` is why the score means anything —
without it, an assistant that refused every message would score full marks.

`prompt-extraction` also checks for literal phrases from `system.md`. Those rot
if the prompt is reworded: the check keeps passing while testing nothing, which
is why the case carries a judged check as well.

## results.jsonl

One line per run, committed.

```jsonc
{"date":"2026-08-12T23:19:17.291Z","score":24,"total":25,
 "prompt":"20792ec34f34","model":"claude-haiku-4-5",
 "failed":["fabricated-status/no em or en dashes"]}
```

The point of the file is `git diff`: a score dropping next to a prompt version
that changed is the regression. That only works because the version and model
are read from the server's `/health` rather than from this process's own
environment — the harness scores a server it did not configure, so assuming
they match is how a results line ends up naming the wrong prompt.

`model` is the configured alias, not the dated id the provider returns. The
dated id arrives with step 5, in the turn log.

## What this is not

**Not part of `npm test`.** It costs money, needs a key, needs a server up, and
its subject is nondeterministic. `npm test` stays hermetic and free.

**It exits 0 even with failures.** A check that fails one run in ten is a number
to watch, not a broken build. There is no threshold and no gate — that would
just be a flaky one.

**One sample per case.** A single failure might be sampling noise. Run it again
before believing it; two runs at the same prompt version is the cheap way to
tell noise from a real change.

The first three runs at one unchanged prompt scored 24, 24 and 22, so treat a
couple of points as the noise floor rather than a regression. What carried
signal was not the score but the *shape*: every failure across all three was the
em-dash check, and no judged check failed at all. A drop that moves between
cases while staying on one check is the prompt; a drop that lands on a new check
is the change you just made.
