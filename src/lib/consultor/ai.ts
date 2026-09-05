import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

// Chamadas à API da Anthropic (server-only). Opus 5 decide (ranking e
// revisão das posições); Sonnet 5 escreve o relatório. System prompt vai com
// cache_control porque é igual em todas as rodadas.

export const MODELS = {
  rank: "claude-opus-5",
  narrative: "claude-sonnet-5",
} as const;

// US$ por milhão de tokens (tabela de preços da API, jun/2026); leitura de
// cache ~10% do input, gravação ~125%
const PRICE: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    costUsd: Math.round((a.costUsd + b.costUsd) * 10_000) / 10_000,
  };
}

function usageOf(model: string, u: Anthropic.Usage): Usage {
  const p = PRICE[model] ?? PRICE["claude-opus-5"];
  const input = u.input_tokens;
  const output = u.output_tokens;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const costUsd =
    (input * p.input + output * p.output + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite) / 1e6;
  return { input, output, cacheRead, cacheWrite, costUsd: Math.round(costUsd * 10_000) / 10_000 };
}

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY não configurada (.env.local e Vercel).");
  }
  // cada etapa da análise roda numa função com limite de 300 s
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 270_000, maxRetries: 1 });
  return client;
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function guardStop(message: Anthropic.Message) {
  if (message.stop_reason === "refusal") {
    throw new Error("A IA recusou a solicitação; tente de novo mais tarde.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("A resposta da IA estourou o limite de tokens; tente de novo.");
  }
}

export interface StructuredCall<T> {
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  effort?: "medium" | "high";
}

// Resposta em JSON validado pelo schema. Streaming evita timeout de HTTP em
// respostas longas; finalMessage() junta tudo.
export async function runStructured<T>(call: StructuredCall<T>): Promise<{ data: T; usage: Usage }> {
  const anthropic = getAnthropic();
  const stream = anthropic.messages.stream({
    model: call.model,
    max_tokens: call.maxTokens ?? 12_000,
    system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: call.user }],
    thinking: { type: "adaptive" },
    output_config: {
      effort: call.effort ?? "high",
      format: zodOutputFormat(call.schema),
    },
  });
  const message = await stream.finalMessage();
  guardStop(message);
  const text = textOf(message);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("A resposta da IA não veio em JSON válido.");
  }
  const result = call.schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`A resposta da IA não bateu com o formato esperado: ${result.error.issues[0]?.message ?? ""}`);
  }
  return { data: result.data, usage: usageOf(call.model, message.usage) };
}

export interface TextCall {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

export async function runText(call: TextCall): Promise<{ text: string; usage: Usage }> {
  const anthropic = getAnthropic();
  const stream = anthropic.messages.stream({
    model: call.model,
    max_tokens: call.maxTokens ?? 6_000,
    system: [{ type: "text", text: call.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: call.user }],
    thinking: { type: "adaptive" },
    output_config: { effort: call.effort ?? "medium" },
  });
  const message = await stream.finalMessage();
  guardStop(message);
  return { text: textOf(message).trim(), usage: usageOf(call.model, message.usage) };
}
