/**
 * Phase 4D-2 — ücretsiz LLM sağlayıcısı (NVIDIA NIM / build.nvidia.com).
 * OpenAI-uyumlu uç nokta — gerçek çağrı mantığı
 * `openai-compatible-provider.ts`'te; bu dosya yalnızca NVIDIA'ya özgü
 * `baseURL`/varsayılan model/anahtar çözümünü verir.
 *
 * API anahtarı: `LLM_API_KEY` (sağlayıcı-bağımsız) → yoksa `NVIDIA_API_KEY`.
 * (Anahtarlar `nvapi-` ile başlar — build.nvidia.com üzerinden kartsız
 * alınabilir.)
 */

import { OpenAICompatibleIntentProvider, type OpenAICompatibleChatClient } from "./openai-compatible-provider.js";

function resolveApiKey(): string | undefined {
  return process.env.LLM_API_KEY ?? process.env.NVIDIA_API_KEY ?? undefined;
}

export function createNvidiaProvider(
  options: { client?: OpenAICompatibleChatClient; apiKey?: string; model?: string } = {}
): OpenAICompatibleIntentProvider {
  return new OpenAICompatibleIntentProvider({
    client: options.client,
    apiKey: options.apiKey ?? resolveApiKey(),
    baseURL: "https://integrate.api.nvidia.com/v1",
    // Phase 4D-2: `meta/llama-3.1-70b-instruct` (ilk seçim) 2026-08-26'da
    // emekliye ayrıldı (410 Gone) — gerçek smoke test SIRASINDA
    // keşfedildi. `openai/gpt-oss-20b` canlı hesaba karşı doğrulandı:
    // hem erişilebilir hem de (nemotron ailesinin aksine) verbose bir
    // "reasoning" önsözü olmadan doğrudan temiz JSON üretiyor.
    model: options.model ?? "openai/gpt-oss-20b",
    providerLabel: "NVIDIA NIM",
  });
}
