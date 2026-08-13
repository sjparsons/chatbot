// Must come first: it populates process.env, which the judge reads below.
import "./env.js";
import { appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cases, styleChecks } from "./cases.js";
import { judgeUsage } from "./checks.js";
import { fetchHealth, runTurns } from "./client.js";
import { costUsd } from "./cost.js";

const baseUrl = process.env.EVAL_BASE_URL ?? "http://localhost:3001";
const resultsFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "results.jsonl",
);

interface Failure {
  case: string;
  check: string;
  reason: string;
}

const health = await fetchHealth(baseUrl);

console.log(`\n${baseUrl}   prompt ${health.prompt}   model ${health.model}\n`);

const failures: Failure[] = [];
let passed = 0;
let total = 0;

// Cases run one at a time. They are conversations against a shared service,
// and interleaving them would make a rate limit look like a regression.
for (const testCase of cases) {
  const { sessionId, reply } = await runTurns(baseUrl, testCase.turns);
  const checks = [...testCase.checks, ...styleChecks];

  // Checks within a case are independent, and most of them are a model call.
  const verdicts = await Promise.all(
    checks.map(async (check) => ({ check, verdict: await check.run(reply) })),
  );

  const failed = verdicts.filter(({ verdict }) => verdict !== true);
  passed += verdicts.length - failed.length;
  total += verdicts.length;

  const score = `${verdicts.length - failed.length}/${verdicts.length}`;
  console.log(
    failed.length === 0
      ? `  ${testCase.name.padEnd(28)} ${score}`
      : `  ${testCase.name.padEnd(28)} ${score}   session ${sessionId}`,
  );

  for (const { check, verdict } of failed) {
    const reason = typeof verdict === "string" ? verdict : "failed";
    failures.push({ case: testCase.name, check: check.name, reason });
    console.log(`      x ${check.name}: ${reason}`);
  }
}

console.log(`\n  ${passed}/${total} checks`);

// Judging only. The assistant's own inference is billed to whatever key the
// server is running on, and it does not report tokens — so this is the cost of
// grading, not the cost of the run, and the label has to keep saying so.
const cost = costUsd(judgeUsage);
console.log(
  `  judging  ${judgeUsage.calls} calls to ${judgeUsage.model ?? "none"}` +
    `  in=${judgeUsage.inputTokens} out=${judgeUsage.outputTokens}` +
    (cost === null ? "  (unpriced model)" : `  ~$${cost.toFixed(4)}`) +
    "\n",
);

// One line per run, in git. The point of the file is `git diff`: a score
// dropping next to a prompt version that changed is the regression, and it is
// only legible because the version was read off the server that produced it.
appendFileSync(
  resultsFile,
  JSON.stringify({
    date: new Date().toISOString(),
    score: passed,
    total,
    prompt: health.prompt,
    model: health.model,
    // Tokens as well as dollars: the rate table is the part that goes stale, so
    // recording the counts keeps every past line repriceable.
    judge: {
      model: judgeUsage.model,
      calls: judgeUsage.calls,
      inputTokens: judgeUsage.inputTokens,
      outputTokens: judgeUsage.outputTokens,
      costUsd: cost,
    },
    failed: failures.map((f) => `${f.case}/${f.check}`),
  }) + "\n",
);

console.log(`  wrote ${resultsFile}\n`);

// Deliberately exits 0 even with failures. The subject is nondeterministic, so
// a check that fails one run in ten is a number to watch, not a broken build.
// A non-zero exit here would turn this into a flaky CI gate.
