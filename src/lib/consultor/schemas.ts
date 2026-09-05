import { z } from "zod";

// Saída estruturada do ranking por categoria (uma chamada da IA por caixa).
// Mantido simples (string, number, enum, array, object) para caber nas
// restrições de structured outputs.

export const RankingSchema = z.object({
  buys: z.array(
    z.object({
      ticker: z.string(),
      action: z.enum(["new", "reinforce"]),
      /** parcela do aporte da categoria; a soma vale 100 */
      weight_pct: z.number(),
      rationale: z.string(),
      /** ex.: "crescimento sem lucro", "setor financeiro: alavancagem natural" */
      flags: z.array(z.string()),
    }),
  ),
  alternatives: z.array(
    z.object({
      ticker: z.string(),
      rationale: z.string(),
    }),
  ),
  holdings_review: z.array(
    z.object({
      ticker: z.string(),
      verdict: z.enum(["keep", "watch", "trim", "sell"]),
      /** só para trim: % da posição a vender; 0 nos demais */
      trim_pct: z.number(),
      rationale: z.string(),
    }),
  ),
  substitutions: z.array(
    z.object({
      sell: z.string(),
      buy: z.string(),
      rationale: z.string(),
    }),
  ),
  notes: z.string(),
});

export type RankingOutput = z.infer<typeof RankingSchema>;
