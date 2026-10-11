/**
 * Phase 5C — bounded, repeated-intent NVIDIA NIM measurement.
 * Run after `npm run build` with an existing key in the environment/.env:
 *   node --env-file-if-exists=.env scripts/nvidia-soak-test.mjs
 * No key or raw model output is printed.
 */
import { performance } from "node:perf_hooks";
import { NluPipeline } from "../dist/nlu/pipeline.js";
import { emptyContext } from "../dist/nlu/types.js";
import { createNvidiaProvider } from "../dist/nlu/providers/nvidia-provider.js";

const scenarios = [
  { id: "sentry_departure", text: "Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç." },
  { id: "climate_departure", text: "Arabadan inince klimayı aç." },
  { id: "reminder_0900", text: "9'da bana hatırlat." },
  { id: "unsupported_live_camera", text: "Arabadan inince Tesla canlı kamerayı aç." },
  { id: "battery_notification", text: "Pil yüzde 20'ye düşünce bana haber ver." },
];

// Only record fixed, non-sensitive expectation checks. Neither the model's
// response nor generated plan content is printed by this measurement script.
function semanticsMatch(scenario, outcome) {
  switch (scenario) {
    case "sentry_departure":
      return outcome.status === "plan"
        && outcome.plan.trigger.type === "ios.bluetooth.disconnected"
        && outcome.plan.trigger.device === "Tesla Model Y"
        && outcome.plan.trigger.params?.vehicle === "Tesla Model Y"
        && JSON.stringify(outcome.plan.steps).includes("tesla.sentry_mode.toggle");
    case "climate_departure":
      return outcome.status === "needs_clarification"
        && outcome.question.id === "vehicle"
        && outcome.intent.steps.some((step) => step.type === "vehicle_climate");
    case "reminder_0900":
      return outcome.status === "needs_clarification"
        && outcome.question.id === "time_of_day"
        && outcome.intent.trigger?.type === "time";
    case "unsupported_live_camera":
      return outcome.status === "unsupported"
        && outcome.intent.steps.some((step) => step.type === "vehicle_camera");
    case "battery_notification":
      return outcome.status === "plan"
        && outcome.plan.trigger.type === "ios.battery.falls_below"
        && JSON.stringify(outcome.plan.steps).includes("ios.notification.show");
    default:
      return false;
  }
}

const rounds = Number(process.env.SOAK_ROUNDS ?? 3);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) {
  throw new Error("SOAK_ROUNDS must be an integer from 1 to 10");
}
if (!process.env.NVIDIA_API_KEY && !process.env.LLM_API_KEY) {
  throw new Error("NVIDIA_API_KEY or LLM_API_KEY must already be configured");
}

const maxElapsedMs = 30 * 60 * 1000;
let finalFailure = null;
const pipeline = new NluPipeline(undefined, undefined, undefined, createNvidiaProvider(), (diagnostic) => {
  finalFailure = diagnostic;
});
const samples = [];
const started = performance.now();
let consecutiveErrors = 0;
let stopReason = null;

for (let round = 1; round <= rounds && !stopReason; round++) {
  for (const scenario of scenarios) {
    if (performance.now() - started >= maxElapsedMs) {
      stopReason = "elapsed_limit";
      break;
    }
    const before = { ...pipeline.retryMetrics };
    finalFailure = null;
    const callStart = performance.now();
    const outcome = await pipeline.planAsync(scenario.text, emptyContext());
    const latencyMs = Math.round(performance.now() - callStart);
    const after = pipeline.retryMetrics;
    const bucket = after.deterministicFallback > before.deterministicFallback
      ? "deterministic_fallback"
      : after.firstPassSuccess > before.firstPassSuccess
        ? "first_pass"
        : after.repairSuccess > before.repairSuccess
          ? "repair"
          : "provider_error";
    const sample = {
      round,
      scenario: scenario.id,
      status: outcome.status,
      bucket,
      semanticPass: semanticsMatch(scenario.id, outcome),
      latencyMs,
      ...(outcome.status === "provider_error" && finalFailure ? { failure: finalFailure } : {}),
    };
    samples.push(sample);
    console.log(JSON.stringify(sample));

    consecutiveErrors = bucket === "provider_error" ? consecutiveErrors + 1 : 0;
    if (consecutiveErrors >= 2) {
      stopReason = "two_consecutive_provider_errors";
      break;
    }
  }
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

const byScenario = Object.fromEntries(scenarios.map(({ id }) => {
  const own = samples.filter((sample) => sample.scenario === id);
  return [id, {
    samples: own.length,
    firstPass: own.filter((sample) => sample.bucket === "first_pass").length,
    repair: own.filter((sample) => sample.bucket === "repair").length,
    deterministicFallback: own.filter((sample) => sample.bucket === "deterministic_fallback").length,
    providerError: own.filter((sample) => sample.bucket === "provider_error").length,
    semanticPass: own.filter((sample) => sample.semanticPass).length,
    statuses: own.map((sample) => sample.status),
    latencyMs: {
      p50: percentile(own.map((sample) => sample.latencyMs), 0.5),
      p95: percentile(own.map((sample) => sample.latencyMs), 0.95),
      max: own.length ? Math.max(...own.map((sample) => sample.latencyMs)) : null,
    },
  }];
}));

const summary = {
  model: "openai/gpt-oss-20b",
  plannedTopLevelRequests: rounds * scenarios.length,
  completedTopLevelRequests: samples.length,
  stopReason,
  elapsedMs: Math.round(performance.now() - started),
  retryMetrics: pipeline.retryMetrics,
  semanticPass: samples.filter((sample) => sample.semanticPass).length,
  latencyMs: {
    p50: percentile(samples.map((sample) => sample.latencyMs), 0.5),
    p95: percentile(samples.map((sample) => sample.latencyMs), 0.95),
    max: samples.length ? Math.max(...samples.map((sample) => sample.latencyMs)) : null,
  },
  byScenario,
};
console.log(JSON.stringify({ summary }));
if (stopReason) process.exitCode = 1;
