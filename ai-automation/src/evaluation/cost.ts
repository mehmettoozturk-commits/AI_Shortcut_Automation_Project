/** Offline estimates only: never SDK usage, quota or billing authority. */
export interface PriceAssumption {
  model: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  asOf: string;
  source: string;
}

export const SIMULATED_PRICES: readonly PriceAssumption[] = Object.freeze([
  Object.freeze({ model: "openai/gpt-oss-20b", inputUsdPerMillion: 0.075, outputUsdPerMillion: 0.30,
    asOf: "2026-10-15", source: "https://console.groq.com/docs/models" }),
  Object.freeze({ model: "openai/gpt-oss-120b", inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.60,
    asOf: "2026-10-15", source: "https://console.groq.com/docs/models" }),
]);

export function estimateCost(inputTokens: number, outputTokens: number, price: PriceAssumption): number {
  for (const value of [inputTokens, outputTokens, price.inputUsdPerMillion, price.outputUsdPerMillion]) {
    if (!Number.isFinite(value) || value < 0) throw new Error("Invalid simulated cost input");
  }
  if (!Number.isInteger(inputTokens) || !Number.isInteger(outputTokens)
    || !price.model || !/^\d{4}-\d{2}-\d{2}$/.test(price.asOf) || !price.source.startsWith("https://")) {
    throw new Error("Missing price provenance or invalid token estimate");
  }
  return (inputTokens * price.inputUsdPerMillion + outputTokens * price.outputUsdPerMillion) / 1_000_000;
}

/** Character heuristic, including prompt/schema/history and repair text; not a tokenizer.
 * Hidden reasoning tokens are unknowable in this offline fixture and excluded. */
export const estimateTokens = (text: string): number => Math.ceil([...text].length / 4);
