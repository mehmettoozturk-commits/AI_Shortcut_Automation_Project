import { describe, expect, it } from "vitest";
import { NluPipeline } from "../src/nlu/pipeline.js";
import type { NluProvider } from "../src/nlu/ports.js";
import { emptyContext, type IntentResult } from "../src/nlu/types.js";

function providerClaimingVehicle(vehicle: string): NluProvider {
  return {
    async plan(input: string): Promise<IntentResult> {
      return {
        intent: "create_automation",
        confidence: 0.95,
        trigger: { type: "vehicle_departure", details: { vehicle } },
        steps: [{ type: "vehicle_climate", details: { vehicle } }],
        entities: { vehicle: { value: vehicle, raw: vehicle } },
        missing: [],
        sourceText: input,
      };
    },
  };
}

describe("vehicle action grounding across async providers", () => {
  it("asks which vehicle when the model invents one from an unspecified car", async () => {
    const context = emptyContext();
    const pipeline = new NluPipeline(undefined, undefined, undefined, providerClaimingVehicle("Tesla Model Y"));

    const result = await pipeline.planAsync("Arabadan inince klimayı aç.", context);

    expect(result.status).toBe("needs_clarification");
    if (result.status !== "needs_clarification") return;
    expect(result.question.id).toBe("vehicle");
    expect(result.intent.entities.vehicle).toBeUndefined();
    expect(result.intent.trigger?.details?.vehicle).toBeUndefined();
    expect(result.intent.steps[0]?.details?.vehicle).toBeUndefined();
    expect(context.currentPlan?.trigger.device).toBeNull();
    expect(context.currentPlan?.trigger.params?.vehicle).toBeUndefined();
    expect(JSON.stringify(context.currentPlan?.steps)).toContain("tesla.climate.start");
  });

  it("uses the vehicle actually named by the user over a different model claim", async () => {
    const pipeline = new NluPipeline(undefined, undefined, undefined, providerClaimingVehicle("Tesla Model 3"));

    const result = await pipeline.planAsync("Arabadan inince Tesla Model Y'nin klimasını aç.", emptyContext());

    expect(result.status).toBe("plan");
    if (result.status !== "plan") return;
    expect(result.plan.trigger.device).toBe("Tesla Model Y");
    expect(result.plan.trigger.params?.vehicle).toBe("Tesla Model Y");
    expect(result.intent.entities.vehicle?.value).toBe("Tesla Model Y");
    expect(result.intent.steps[0]?.details?.vehicle).toBe("Tesla Model Y");
  });

  it("reuses a vehicle selected within the same conversation attempt", async () => {
    const context = emptyContext();
    context.selectedEntities.vehicle = { value: "Tesla Model 3", raw: "Tesla Model 3" };
    const pipeline = new NluPipeline(undefined, undefined, undefined, providerClaimingVehicle("Tesla Model Y"));

    const result = await pipeline.planAsync("Arabadan inince klimayı aç.", context);

    expect(result.status).toBe("plan");
    if (result.status !== "plan") return;
    expect(result.plan.trigger.device).toBe("Tesla Model 3");
    expect(result.plan.trigger.params?.vehicle).toBe("Tesla Model 3");
  });
});
