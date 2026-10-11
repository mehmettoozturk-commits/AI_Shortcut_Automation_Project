import { describe, expect, it } from "vitest";
import { validateSchema } from "../src/validators/schema-validator.js";
import { validatePermissions } from "../src/validators/permission-validator.js";
import { validateSetupRequirements } from "../src/validators/setup-requirement-validator.js";
import { findCapability } from "../src/capability-registry/registry.js";

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

describe("runtime permissions vs external setup requirements", () => {
  it("does not treat Shortcuts/Tesla requirements as app OS permissions", () => {
    const result = validatePermissions(parse(VALID_PLAN), { grantedPermissions: [] });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("keeps external setup requirements visible even with app permission grants", () => {
    const result = validateSetupRequirements(parse(VALID_PLAN));
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => i.code)).toContain("setup_requirement_unverified");
    expect(result.issues.some((i) => i.message.includes("bluetooth"))).toBe(true);
    expect(result.issues.some((i) => i.message.includes("tesla_account"))).toBe(true);
  });

  it("fails closed when a future app-owned runtime permission is denied", () => {
    const lookup = (id: string) => {
      const cap = findCapability(id);
      return cap && id === "ios.bluetooth.disconnected"
        ? { ...cap, runtimePermissions: ["app_microphone"] }
        : cap;
    };
    const denied = validatePermissions(parse(VALID_PLAN), {
      grantedPermissions: [], lookupCapability: lookup,
    });
    expect(denied.ok).toBe(false);
    expect(denied.issues.some((i) => i.code === "missing_permission")).toBe(true);
    const granted = validatePermissions(parse(VALID_PLAN), {
      grantedPermissions: ["app_microphone"], lookupCapability: lookup,
    });
    expect(granted.ok).toBe(true);
  });
});
