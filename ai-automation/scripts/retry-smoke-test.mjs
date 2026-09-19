/**
 * Phase 4E-3d/e — gerçek NVIDIA NIM'e karşı retry/repair katmanının
 * ölçümü. GEÇİCİ bir betik değil, ama otomatik test paketinin (npm test)
 * parçası DEĞİL — gerçek, ücretli/rate-limitli bir API'ye karşı çalışır,
 * yalnızca elle çağrılır: `LLM_API_KEY=... LLM_PROVIDER=nvidia node
 * scripts/retry-smoke-test.mjs`.
 *
 * `pipeline.retryMetrics`'i (kullanıcıya ASLA gösterilmeyen, yalnızca
 * bu tür ölçümler için var olan iç sayaç) N gerçek istekten sonra
 * raporlar.
 */
import { NluPipeline } from "../dist/nlu/pipeline.js";
import { emptyContext } from "../dist/nlu/types.js";
import { ClaudeIntentProvider } from "../dist/nlu/providers/claude-provider.js";
import { GeminiIntentProvider } from "../dist/nlu/providers/gemini-provider.js";
import { createGroqProvider } from "../dist/nlu/providers/groq-provider.js";
import { createNvidiaProvider } from "../dist/nlu/providers/nvidia-provider.js";

const providerName = (process.env.LLM_PROVIDER ?? "nvidia").toLowerCase();
const providers = {
  anthropic: () => new ClaudeIntentProvider(),
  gemini: () => new GeminiIntentProvider(),
  groq: () => createGroqProvider(),
  nvidia: () => createNvidiaProvider(),
};
if (!providers[providerName]) {
  console.error(`Bilinmeyen LLM_PROVIDER: ${providerName}`);
  process.exit(1);
}

const pipeline = new NluPipeline(undefined, undefined, undefined, providers[providerName]());

const SCENARIOS = [
  "Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç.",
  "Arabadan inince klimayı aç.",
  "9'da bana hatırlat.",
  "Arabadan inince Tesla canlı kamerayı aç.",
  "Pil yüzde 20'ye düşünce bana haber ver.",
];

const results = [];
for (let i = 0; i < SCENARIOS.length; i++) {
  const text = SCENARIOS[i];
  const before = { ...pipeline.retryMetrics };
  const outcome = await pipeline.planAsync(text, emptyContext());
  const after = { ...pipeline.retryMetrics };
  const bucket =
    after.firstPassSuccess > before.firstPassSuccess
      ? "first-pass"
      : after.repairSuccess > before.repairSuccess
        ? "repair"
        : "provider_error";
  results.push({ text, status: outcome.status, bucket, message: outcome.message });
  console.log(`[${i + 1}/${SCENARIOS.length}] "${text}" → ${outcome.status} (${bucket})${outcome.message ? ` — ${outcome.message}` : ""}`);
}

console.log("\n--- Özet ---");
console.log(`Sağlayıcı: ${providerName}`);
console.log(`Toplam istek: ${SCENARIOS.length}`);
console.log(JSON.stringify(pipeline.retryMetrics, null, 2));
