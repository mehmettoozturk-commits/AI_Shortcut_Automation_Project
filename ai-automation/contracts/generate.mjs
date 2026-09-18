/**
 * TS <-> Swift kontrat üreticisi.
 *
 * Bu script, elle yazılmış örnek planları GERÇEK AutomationPlanSchema
 * (zod) ile doğrular ve CAPABILITIES registry'sini olduğu gibi JSON'a
 * döker. Çıktı, Swift tarafının Codable modellerinin decode etmesi
 * gereken TEK doğruluk kaynağıdır — Swift'te capability verisi
 * yeniden yazılmaz, bu JSON'dan okunur.
 *
 * ÇALIŞTIRILDI ve DOĞRULANDI (2026-09-19, gerçek Mac'te): plain `node`
 * .ts dosyalarını import edemiyor (ERR_UNKNOWN_FILE_EXTENSION) — çalışan
 * gerçek komut:
 *   npx tsx contracts/generate.mjs
 */

import { AutomationPlanSchema } from "../src/dsl/schema.ts";
import { CAPABILITIES } from "../src/capability-registry/registry.ts";
import { checkRegistryContract } from "../src/compiler/contract.ts";
import { writeFileSync } from "node:fs";

const SAMPLE_PLANS = {
  vehicleSentry: {
    name: "Tesla Sentry Mode",
    trigger: { type: "ios.bluetooth.disconnected", device: "Tesla Model Y" },
    steps: [
      { type: "ask_confirmation", message: "Sentry Mode'u açmak ister misin?" },
      {
        type: "conditional",
        condition: "answer == yes",
        then: [{ type: "tesla.sentry_mode.toggle" }],
        else: [],
      },
    ],
  },
  dailyReminder: {
    name: "İlaç hatırlatması",
    trigger: { type: "ios.time_of_day.daily", params: { time: "21:00" } },
    steps: [{ type: "ios.notification.show", params: { message: "Aspirin al" } }],
  },
  batteryAlert: {
    name: "Pil uyarısı",
    trigger: { type: "ios.battery.falls_below", params: { level: 20 } },
    steps: [{ type: "ios.notification.show" }],
  },
};

let hadError = false;
const validated = {};
for (const [key, raw] of Object.entries(SAMPLE_PLANS)) {
  const result = AutomationPlanSchema.safeParse(raw);
  if (!result.success) {
    console.error(`FIXTURE INVALID: ${key}`, result.error.issues);
    hadError = true;
    continue;
  }
  validated[key] = result.data;
}

const registryViolations = checkRegistryContract();
if (registryViolations.length > 0) {
  console.error("REGISTRY CONTRACT VIOLATIONS:", registryViolations);
  hadError = true;
}

if (hadError) {
  console.error("Kontrat üretimi BAŞARISIZ. Fixture yazılmadı.");
  process.exit(1);
}

writeFileSync(
  "contracts/automation-plan-samples.json",
  JSON.stringify(validated, null, 2) + "\n",
  "utf8"
);
writeFileSync(
  "contracts/capability-registry-snapshot.json",
  JSON.stringify(CAPABILITIES, null, 2) + "\n",
  "utf8"
);
writeFileSync(
  "contracts/meta.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      schemaSource: "src/dsl/schema.ts (AutomationPlanSchema, zod)",
      registrySource: "src/capability-registry/registry.ts (CAPABILITIES)",
      note: "Bu dosyalar gerçek zod şeması ile doğrulanmıştır. Swift Codable modelleri bu JSON'ları decode etmelidir; registry verisi Swift'te tekrar yazılmaz.",
    },
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(`OK: ${Object.keys(validated).length} plan doğrulandı, ${CAPABILITIES.length} capability dışa aktarıldı.`);
