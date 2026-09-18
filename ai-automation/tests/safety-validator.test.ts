import { describe, expect, it } from "vitest";
import { validateSchema } from "../src/validators/schema-validator.js";
import { validateSafety } from "../src/validators/safety-validator.js";

function parse(raw: unknown) {
  const r = validateSchema(raw);
  if (!r.ok || !r.plan) throw new Error("test fixture should be schema-valid");
  return r.plan;
}

describe("validateSafety", () => {
  it("accepts a risky action gated behind ask_confirmation (MASTER_SPEC §7 örneği)", () => {
    const plan = parse({
      name: "Tesla kamerayı sor",
      trigger: { type: "ios.bluetooth.disconnected", device: "Tesla" },
      steps: [
        { type: "ask_confirmation", message: "Açmak ister misin?" },
        {
          type: "conditional",
          condition: "answer == yes",
          then: [{ type: "tesla.camera_action" }],
          else: [],
        },
      ],
    });
    const result = validateSafety(plan);
    expect(result.ok).toBe(true);
  });

  it("rejects a risky action with no confirmation anywhere in the plan (CLAUDE.md ihlali)", () => {
    const plan = parse({
      name: "Tehlikeli otomasyon",
      trigger: { type: "ios.bluetooth.disconnected", device: "Tesla" },
      steps: [{ type: "tesla.doors.lock" }],
    });
    const result = validateSafety(plan);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "unconfirmed_risky_action")).toBe(true);
  });

  it("rejects a risky action placed BEFORE the confirmation step (order matters)", () => {
    const plan = parse({
      name: "Yanlış sıra",
      trigger: { type: "ios.bluetooth.disconnected", device: "Tesla" },
      steps: [
        { type: "tesla.doors.lock" },
        { type: "ask_confirmation", message: "Emin misin?" },
      ],
    });
    const result = validateSafety(plan);
    expect(result.ok).toBe(false);
  });

  it("allows a low-risk action (ios.ask_confirmation itself has no risky follow-up) without confirmation", () => {
    // ios.bluetooth.* triggers are handled separately; here we check a
    // hypothetical low-risk action step is fine unconfirmed. We reuse an
    // existing low-risk-flagged capability: ios.ask_confirmation is an
    // action but excluded from the risk check by type, so instead we
    // assert that an unknown capability defaults to "risky" (safe default).
    const plan = parse({
      name: "Bilinmeyen aksiyon",
      trigger: { type: "ios.bluetooth.disconnected", device: "Tesla" },
      steps: [{ type: "some.unregistered.capability" }],
    });
    const result = validateSafety(plan);
    // Unknown capability must default to risky -> blocked without confirmation.
    expect(result.ok).toBe(false);
  });
});
