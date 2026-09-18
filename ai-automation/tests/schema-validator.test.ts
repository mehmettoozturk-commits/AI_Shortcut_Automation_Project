import { describe, expect, it } from "vitest";
import { validateSchema } from "../src/validators/schema-validator.js";

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

describe("validateSchema", () => {
  it("accepts a well-formed plan (MASTER_SPEC §7 örneği)", () => {
    const result = validateSchema(VALID_PLAN);
    expect(result.ok).toBe(true);
    expect(result.plan?.name).toBe("Tesla kamerayı sor");
  });

  it("rejects a plan with no name", () => {
    const { name, ...rest } = VALID_PLAN;
    const result = validateSchema(rest);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "name")).toBe(true);
  });

  it("rejects a plan with no steps", () => {
    const result = validateSchema({ ...VALID_PLAN, steps: [] });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "steps")).toBe(true);
  });

  it("rejects a step using the reserved 'ask_confirmation' type with extra shape", () => {
    // An action step literally named "conditional" without then/else is invalid shape.
    const result = validateSchema({
      ...VALID_PLAN,
      steps: [{ type: "conditional" }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects completely malformed input", () => {
    const result = validateSchema({ foo: "bar" });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
