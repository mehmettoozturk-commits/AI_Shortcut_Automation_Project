import { describe, expect, it } from "vitest";
import { validateSchema } from "../src/validators/schema-validator.js";
import { validateCapabilities } from "../src/validators/capability-validator.js";

const VALID_PLAN = {
  name: "Tesla kamerayı sor",
  trigger: { type: "ios.bluetooth.disconnected", device: "Tesla" },
  steps: [
    { type: "ask_confirmation", message: "Tesla canlı kamerayı açmak ister misin?" },
    {
      type: "conditional",
      condition: "answer == yes",
      then: [{ type: "tesla.camera_action" }],
      else: [],
    },
  ],
};

function parse(raw: unknown) {
  const r = validateSchema(raw);
  if (!r.ok || !r.plan) throw new Error("test fixture should be schema-valid");
  return r.plan;
}

describe("validateCapabilities", () => {
  it("accepts a plan using only registered capabilities", () => {
    const result = validateCapabilities(parse(VALID_PLAN), { platform: "ios" });
    expect(result.ok).toBe(true);
  });

  it("warns (not errors) that tesla.camera_action needs guided setup — it is NOT natively supported", () => {
    const result = validateCapabilities(parse(VALID_PLAN), { platform: "ios" });
    const warning = result.issues.find((i) => i.code === "requires_guided_setup");
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
  });

  it("rejects an unknown/hallucinated trigger capability", () => {
    const plan = parse({
      ...VALID_PLAN,
      trigger: { type: "ios.made_up_trigger" },
    });
    const result = validateCapabilities(plan, { platform: "ios" });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "unknown_capability")).toBe(true);
  });

  it("rejects an unknown/hallucinated action capability", () => {
    const plan = parse({
      ...VALID_PLAN,
      steps: [
        { type: "ask_confirmation", message: "Emin misin?" },
        { type: "conditional", condition: "answer == yes", then: [{ type: "tesla.invent_a_feature" }], else: [] },
      ],
    });
    const result = validateCapabilities(plan, { platform: "ios" });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "unknown_capability")).toBe(true);
  });

  it("rejects a platform mismatch (e.g. android plan using an ios-only capability)", () => {
    const result = validateCapabilities(parse(VALID_PLAN), { platform: "android" });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "platform_mismatch")).toBe(true);
  });
});
