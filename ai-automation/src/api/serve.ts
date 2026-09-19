/** `npm run serve` giriş noktası — bkz. server.ts. */
import { createPlanServer } from "./server.js";
import { NluPipeline } from "../nlu/pipeline.js";
import { ClaudeIntentProvider } from "../nlu/providers/claude-provider.js";

/**
 * Phase 4B — API anahtarı YALNIZCA runtime environment'tan okunur,
 * asla hardcode edilmez (`.env` zaten `.gitignore`'da). `LLM_API_KEY`
 * verilmişse gerçek LLM sağlayıcısı kullanılır; yoksa kural tabanlı
 * sağlayıcıya (mevcut, deterministik) sessizce DEĞİL — açıkça
 * loglanarak düşülür, "LLM kullanılıyor" yanılgısı oluşmasın diye.
 */
const apiKey = process.env.LLM_API_KEY ?? process.env.ANTHROPIC_API_KEY;
const pipeline = apiKey
  ? new NluPipeline(undefined, undefined, undefined, new ClaudeIntentProvider({ apiKey: process.env.LLM_API_KEY }))
  : new NluPipeline();

if (!apiKey) {
  console.warn("LLM_API_KEY/ANTHROPIC_API_KEY tanımlı değil — kural tabanlı (deterministik) sağlayıcı kullanılıyor.");
} else {
  console.log("Gerçek LLM sağlayıcısı (Claude) etkin.");
}

const port = Number(process.env.PORT ?? 3000);
createPlanServer({ pipeline }).listen(port, () => {
  console.log(`POST /plan dinleniyor: http://localhost:${port}/plan`);
});
