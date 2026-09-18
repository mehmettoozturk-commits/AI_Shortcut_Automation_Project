import { describe, expect, it } from "vitest";
import { validateSchema } from "../src/validators/schema-validator.js";
import { validatePermissions } from "../src/validators/permission-validator.js";

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

describe("validatePermissions", () => {
  it("passes when all required permissions are granted", () => {
    const result = validatePermissions(parse(VALID_PLAN), {
      grantedPermissions: ["bluetooth", "tesla_account"],
    });
    expect(result.ok).toBe(true);
  });

  it("fails when bluetooth permission is missing", () => {
    const result = validatePermissions(parse(VALID_PLAN), {
      grantedPermissions: ["tesla_account"],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("bluetooth"))).toBe(true);
  });

  it("fails when tesla_account permission is missing", () => {
    const result = validatePermissions(parse(VALID_PLAN), {
      grantedPermissions: ["bluetooth"],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("tesla_account"))).toBe(true);
  });

  it("fails when no permissions are granted at all", () => {
    const result = validatePermissions(parse(VALID_PLAN), { grantedPermissions: [] });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });
});
