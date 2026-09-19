/** `npm run serve` giriş noktası — bkz. server.ts. */
import { createPlanServer } from "./server.js";
import { NluPipeline } from "../nlu/pipeline.js";
import type { NluProvider } from "../nlu/ports.js";
import { ClaudeIntentProvider } from "../nlu/providers/claude-provider.js";
import { GeminiIntentProvider } from "../nlu/providers/gemini-provider.js";
import { createGroqProvider } from "../nlu/providers/groq-provider.js";
import { createNvidiaProvider } from "../nlu/providers/nvidia-provider.js";

/**
 * Phase 4D-2 — Anthropic'e ek olarak ücretsiz katmanlı sağlayıcılar
 * (Google Gemini, Groq, NVIDIA NIM) eklendi; hepsi AYNI `NluProvider`
 * sınırından (Phase 4B) geçer, `NluPipeline`/registry/validation
 * zincirinde HİÇBİR fark yaratmaz — yalnızca hangi LLM'in semantik
 * çıktı ürettiği değişir.
 *
 * `LLM_PROVIDER` (`anthropic` | `gemini` | `groq` | `nvidia`,
 * varsayılan `anthropic` — Phase 4B'yle geriye dönük uyumlu) hangi
 * sağlayıcının kullanılacağını seçer. API anahtarı YALNIZCA runtime
 * environment'tan okunur, asla hardcode edilmez (`.env` zaten
 * `.gitignore`'da): `LLM_API_KEY` (sağlayıcı-bağımsız) → yoksa seçilen
 * sağlayıcının kendi değişkeni. Anahtar yoksa sessizce DEĞİL, açıkça
 * loglanarak kural tabanlı (deterministik) sağlayıcıya düşülür —
 * "LLM kullanılıyor" yanılgısı oluşmasın diye.
 */
type ProviderName = "anthropic" | "gemini" | "groq" | "nvidia";

const PROVIDER_KEY_ENV: Record<ProviderName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  nvidia: "NVIDIA_API_KEY",
};

function hasKey(name: ProviderName): boolean {
  return Boolean(process.env.LLM_API_KEY ?? process.env[PROVIDER_KEY_ENV[name]]);
}

function buildProvider(name: ProviderName): NluProvider {
  switch (name) {
    case "anthropic":
      return new ClaudeIntentProvider();
    case "gemini":
      return new GeminiIntentProvider();
    case "groq":
      return createGroqProvider();
    case "nvidia":
      return createNvidiaProvider();
  }
}

const KNOWN_PROVIDERS: readonly ProviderName[] = ["anthropic", "gemini", "groq", "nvidia"];
const requested = (process.env.LLM_PROVIDER ?? "anthropic").toLowerCase();
const providerName: ProviderName = (KNOWN_PROVIDERS as readonly string[]).includes(requested)
  ? (requested as ProviderName)
  : "anthropic";

if (process.env.LLM_PROVIDER && providerName !== process.env.LLM_PROVIDER.toLowerCase()) {
  console.warn(`Bilinmeyen LLM_PROVIDER="${process.env.LLM_PROVIDER}" — "anthropic" varsayılıyor.`);
}

const providerAvailable = hasKey(providerName);
const pipeline = providerAvailable ? new NluPipeline(undefined, undefined, undefined, buildProvider(providerName)) : new NluPipeline();

if (!providerAvailable) {
  console.warn(
    `LLM_API_KEY/${PROVIDER_KEY_ENV[providerName]} tanımlı değil — kural tabanlı (deterministik) sağlayıcı kullanılıyor.`
  );
} else {
  console.log(`Gerçek LLM sağlayıcısı etkin: ${providerName}.`);
}

const port = Number(process.env.PORT ?? 3000);
createPlanServer({ pipeline }).listen(port, () => {
  console.log(`POST /plan dinleniyor: http://localhost:${port}/plan`);
});
