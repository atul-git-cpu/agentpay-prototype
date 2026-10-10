/**
 * AI agent that buys API calls on its own.
 *
 * Task: verify a vendor list's GST numbers before onboarding. The agent decides
 * which calls are worth paying for, pays per call from its Circle-managed wallet,
 * and reports back. Guardrails are enforced in code, never left to the model:
 *   - hard spend budget (AGENT_BUDGET_USDC) and call cap (AGENT_MAX_CALLS)
 *   - never pays twice for the same input (results are cached)
 *
 * Usage:  npm run agent            (default task)
 *         npm run agent -- "your own task text"
 */
import { appendFile } from "node:fs/promises";
import { parseUnits, formatUnits } from "viem";
import { config, AGENT_RUNS_FILE } from "../lib/config.js";
import { createCirclePayer } from "../lib/circle-payer.js";
import { chat, type ChatMessage, type ToolDefinition } from "./llm.js";

const DEFAULT_TASK = `We are onboarding these vendors and need their GSTINs verified before paying them:
- Sri Lakshmi Traders: 36ABCPK1234F1Z6
- Konark Components: 29AAACM5678L1ZT
- Rao Logistics: 27AABFR9012Q1ZR
- Sri Lakshmi Traders (duplicate row): 36ABCPK1234F1Z6
- Mehta Exports: 07AAGCS3456K1Z1
- Unknown vendor: 12345
For each vendor, say whether the GSTIN is valid and its state. Keep spending low.`;

const task = process.argv.slice(2).join(" ").trim() || DEFAULT_TASK;
const base = config.sellerBaseUrl.replace(/\/$/, "");
const budget = parseUnits(String(config.agentBudgetUsdc), 6);
const payer = createCirclePayer();

let spent = 0n;
let paidCalls = 0;
const cache = new Map<string, unknown>();
const events: Record<string, unknown>[] = [];
const log = (event: Record<string, unknown>) => events.push({ at: new Date().toISOString(), ...event });

const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_service_pricing",
      description: "Free. Returns the GSTIN validation service's price per call and currency.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_remaining_budget",
      description: "Free. Returns how much USDC you can still spend in this run, and calls made so far.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "validate_gstin",
      description:
        "PAID: costs the price per call in USDC. Validates one Indian GSTIN (15 characters) and returns " +
        "validity, state and entity type. Only call it for inputs that could be a real GSTIN.",
      parameters: {
        type: "object",
        properties: { gstin: { type: "string", description: "The 15-character GSTIN" } },
        required: ["gstin"],
      },
    },
  },
];

async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "get_service_pricing") {
    return fetch(`${base}/v1/pricing`).then((r) => r.json());
  }
  if (name === "get_remaining_budget") {
    return {
      remainingUsdc: formatUnits(budget - spent, 6),
      spentUsdc: formatUnits(spent, 6),
      paidCalls,
      maxCalls: config.agentMaxCalls,
    };
  }
  if (name === "validate_gstin") {
    const gstin = String(args.gstin ?? "").trim().toUpperCase();
    if (cache.has(gstin)) {
      log({ type: "cache_hit", gstin });
      console.log(`   (already checked ${gstin} — reused result, no payment)`);
      return { ...(cache.get(gstin) as object), note: "cached result, not charged again" };
    }
    if (paidCalls >= config.agentMaxCalls) {
      return { error: "Call limit reached for this run. Do not call validate_gstin again." };
    }
    const pricing = (await fetch(`${base}/v1/pricing`).then((r) => r.json())) as { pricePerCall: string };
    const price = parseUnits(pricing.pricePerCall.replace("$", ""), 6);
    if (spent + price > budget) {
      return { error: `Budget exhausted (${formatUnits(spent, 6)} of ${config.agentBudgetUsdc} USDC spent).` };
    }
    const paid = await payer.pay<Record<string, unknown>>(`${base}/v1/gstin/${encodeURIComponent(gstin)}`);
    spent += paid.amountAtomic;
    paidCalls++;
    cache.set(gstin, paid.data);
    log({ type: "payment", gstin, amountUsdc: paid.amountUsdc, nonce: paid.nonce, result: paid.data });
    console.log(`   paid ${paid.amountUsdc} USDC (signed by Circle wallet)  nonce ${paid.nonce.slice(0, 12)}…`);
    return paid.data;
  }
  return { error: `Unknown tool ${name}` };
}

const messages: ChatMessage[] = [
  {
    role: "system",
    content:
      "You are a procurement assistant with a small USDC budget. You can call paid APIs. " +
      "Be cost-conscious: check pricing first, never pay for duplicate inputs, and skip inputs " +
      "that obviously cannot be a GSTIN (it must be exactly 15 characters). " +
      "Explain briefly why you make each paid call. End with a short table of results.",
  },
  { role: "user", content: task },
];

console.log(`Agent wallet (Circle-managed): ${payer.address}`);
console.log(`Model: ${config.llmModel}  |  Budget: ${config.agentBudgetUsdc} USDC, max ${config.agentMaxCalls} paid calls\n`);
console.log(`Task:\n${task}\n`);
log({ type: "start", task, model: config.llmModel, agent: payer.address });

let finalAnswer = "";
for (let turn = 0; turn < 12; turn++) {
  const reply = await chat(messages, tools);
  messages.push({ role: "assistant", content: reply.content ?? null, tool_calls: reply.tool_calls });
  if (reply.content?.trim()) {
    console.log(`Agent: ${reply.content.trim()}\n`);
    log({ type: "thought", text: reply.content.trim() });
  }
  if (!reply.tool_calls?.length) {
    finalAnswer = reply.content?.trim() ?? "";
    break;
  }
  for (const call of reply.tool_calls) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      /* model sent invalid JSON; tool gets empty args */
    }
    console.log(`-> ${call.function.name}(${Object.keys(args).length ? JSON.stringify(args) : ""})`);
    log({ type: "tool_call", name: call.function.name, args });
    let result: unknown;
    try {
      result = await runTool(call.function.name, args);
    } catch (err) {
      result = { error: (err as Error).message };
      console.log(`   error: ${(err as Error).message}`);
    }
    messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
  }
}

console.log("—".repeat(60));
console.log(`Paid calls: ${paidCalls}  |  Spent: ${formatUnits(spent, 6)} USDC of ${config.agentBudgetUsdc} budget`);
log({ type: "end", paidCalls, spentUsdc: formatUnits(spent, 6), finalAnswer });
await appendFile(AGENT_RUNS_FILE, JSON.stringify({ run: events }) + "\n");
console.log("Run log: data/agent-runs.jsonl  |  Seller-side: `npm run reconcile`");
