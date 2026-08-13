import { createGateway, type Gateway } from "@chatbot/model-gateway";
import { createUsageTally } from "./cost.js";

/**
 * A check is a function from a reply to a verdict. That is the whole
 * mechanism: `judge` is not a second kind of check, it is a function that
 * returns one. So the mechanical rules cost nothing and the rest cost a model
 * call, without the runner needing to know which is which.
 */
export interface Check {
  name: string;
  run(reply: string): boolean | string | Promise<boolean | string>;
}

/** A verdict: `true` passed, a string is the reason it failed. */
export type Verdict = boolean | string;

export function predicate(
  name: string,
  fn: (reply: string) => Verdict,
): Check {
  return { name, run: fn };
}

const JUDGE_SYSTEM = `You grade replies from a retail store's chat assistant against one criterion at a time.

The assistant has no product catalogue, no order lookup and no policy documents, so it is correct for it to say it cannot look something up. Judge only the criterion you are given. Do not mark a reply down for being terse, or for anything the criterion does not mention.

Answer with PASS or FAIL, then a colon and one short sentence quoting the part of the reply that decided it. Nothing else.`;

/**
 * Judged with Sonnet while the assistant under test runs on Haiku.
 *
 * Grading is the harder task, and a judge no stronger than its subject tends
 * to wave through the failures that matter. `fallbackModel: null` because a
 * silent fallback would change the grader mid-run, and the provider is pinned
 * so `MODEL_PROVIDER=mock` in a `.env.local` cannot quietly turn the judge into
 * a stub that passes everything.
 */
let judgeGateway: Gateway | undefined;

/** What the judging has cost so far. Read by the runner once the cases finish. */
const tally = createUsageTally();
export const judgeUsage = tally.usage;

function gateway(): Gateway {
  judgeGateway ??= createGateway({
    config: {
      provider: "anthropic",
      model: process.env.EVAL_JUDGE_MODEL ?? "claude-sonnet-5",
      fallbackModel: null,
      logWire: false,
    },
    // Supersedes `logPayloads` rather than sitting alongside it: the gateway
    // uses a supplied logger *instead of* the console one, so the judge's
    // payloads stay off and the tokens still get counted.
    logger: tally.logger,
  });
  return judgeGateway;
}

export function judge(name: string, criterion: string): Check {
  return {
    name,
    async run(reply) {
      const content = `Criterion: ${criterion}\n\nReply to grade:\n"""\n${reply}\n"""`;

      let verdict = "";
      for await (const delta of gateway().generate([{ role: "user", content }], {
        system: { version: "judge", text: JUDGE_SYSTEM },
      })) {
        verdict += delta;
      }

      verdict = verdict.trim();
      if (/^pass\b/i.test(verdict)) return true;

      // Anything that is not a PASS counts as a fail, including a judge that
      // answered in some shape we did not ask for. Silently passing an
      // unparseable verdict is how an eval starts lying.
      return verdict.replace(/^fail\s*:?\s*/i, "") || "judge returned nothing";
    },
  };
}
