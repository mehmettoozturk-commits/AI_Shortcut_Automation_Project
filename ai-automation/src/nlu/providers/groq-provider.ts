/**
 * Phase 4D-2 — ücretsiz LLM sağlayıcısı (Groq). OpenAI-uyumlu uç nokta
 * — gerçek çağrı mantığı `openai-compatible-provider.ts`'te; bu dosya
 * yalnızca Groq'a özgü `baseURL`/varsayılan model/anahtar çözümünü verir.
 *
 * API anahtarı: `LLM_API_KEY` (sağlayıcı-bağımsız) → yoksa `GROQ_API_KEY`.
 * Ücretsiz katman: console.groq.com üzerinden kartsız alınabilir.
 */

import { OpenAICompatibleIntentProvider, type OpenAICompatibleChatClient } from "./openai-compatible-provider.js";

function resolveApiKey(): string | undefined {
  return process.env.LLM_API_KEY ?? process.env.GROQ_API_KEY ?? undefined;
}

export function createGroqProvider(
  options: { client?: OpenAICompatibleChatClient; apiKey?: string; model?: string } = {}
): OpenAICompatibleIntentProvider {
  return new OpenAICompatibleIntentProvider({
    client: options.client,
    apiKey: options.apiKey ?? resolveApiKey(),
    baseURL: "https://api.groq.com/openai/v1",
    // "Production" olarak işaretli, güncel bir model — console.groq.com/docs/models.
    model: options.model ?? "llama-3.3-70b-versatile",
    providerLabel: "Groq",
  });
}
