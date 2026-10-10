/**
 * Minimal client for any OpenAI-compatible chat-completions API with tool calling.
 * Default: Google Gemini's OpenAI-compatible endpoint. Groq (and others) work by
 * changing LLM_BASE_URL / LLM_MODEL / LLM_API_KEY in .env — no code changes.
 */
import { config } from "../lib/config.js";

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export async function chat(messages: ChatMessage[], tools: ToolDefinition[]) {
  const base = config.llmBaseUrl.endsWith("/") ? config.llmBaseUrl : `${config.llmBaseUrl}/`;
  const res = await fetch(`${base}chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.llmApiKey()}`,
    },
    body: JSON.stringify({ model: config.llmModel, messages, tools, tool_choice: "auto" }),
  });

  if (!res.ok) {
    const detail = await res.text();
    const hint =
      res.status === 429
        ? "\nFree-tier rate limit hit. Wait a minute, or switch provider in .env (see README: Groq backup)."
        : res.status === 404
          ? `\nModel "${config.llmModel}" not found. Check the model id available to your key and set LLM_MODEL in .env.`
          : "";
    throw new Error(`Model API error ${res.status}: ${detail.slice(0, 300)}${hint}`);
  }

  const body = (await res.json()) as {
    choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[];
  };
  const message = body.choices?.[0]?.message;
  if (!message) throw new Error("Model API returned no message");
  return message;
}
