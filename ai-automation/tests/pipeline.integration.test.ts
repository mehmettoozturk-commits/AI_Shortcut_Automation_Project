import { describe, expect, it } from "vitest";
import { runValidationPipeline } from "../src/validators/pipeline.js";

/** The exact scenario from MASTER_SPEC §2 / §29 "Başarı Kriterleri". */
const TESLA_SCENARIO = {
  name: "Arabadan ayrılınca Tesla kamerayı sor",
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

describe("runValidationPipeline — E2E happy path (MASTER_SPEC §27)", () => {
  it("completes successfully with all permissions granted", () => {
    const result = runValidationPipeline(TESLA_SCENARIO, {
      platform: "ios",
      grantedPermissions: ["bluetooth", "tesla_account"],
    });
    expect(result.stage).toBe("complete");
    expect(result.ok).toBe(true);
    // Still surfaces the guided-setup warning for the camera action, since
    // it's not natively installable — this must reach the UI, not be hidden.
    expect(result.issues.some((i) => i.code === "requires_guided_setup")).toBe(true);
  });
});

describe("runValidationPipeline — negative tests (MASTER_SPEC §27)", () => {
  it("stops at schema stage on malformed JSON (belirsiz/bozuk giriş)", () => {
    const result = runValidationPipeline({ not: "a valid plan" }, {
      platform: "ios",
      grantedPermissions: [],
    });
    expect(result.stage).toBe("schema");
    expect(result.ok).toBe(false);
  });

  it("fails on unsupported/hallucinated action (desteklenmeyen action)", () => {
    const plan = {
      ...TESLA_SCENARIO,
      steps: [
        { type: "ask_confirmation", message: "Emin misin?" },
        { type: "conditional", condition: "answer == yes", then: [{ type: "tesla.self_destruct" }], else: [] },
      ],
    };
    const result = runValidationPipeline(plan, { platform: "ios", grantedPermissions: ["bluetooth", "tesla_account"] });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "unknown_capability")).toBe(true);
  });

  it("fails on permission denial (izin reddi)", () => {
    const result = runValidationPipeline(TESLA_SCENARIO, {
      platform: "ios",
      grantedPermissions: [], // user denied everything
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "missing_permission")).toBe(true);
  });

  it("fails on wrong device/platform target (yanlış cihaz)", () => {
    const result = runValidationPipeline(TESLA_SCENARIO, {
      platform: "android",
      grantedPermissions: ["bluetooth", "tesla_account"],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "platform_mismatch")).toBe(true);
  });

  it("fails when the AI skips asking for user confirmation before a risky action", () => {
    const plan = {
      name: "Onaysız otomasyon",
      trigger: { type: "ios.bluetooth.disconnected", device: "Tesla" },
      steps: [{ type: "tesla.doors.lock" }], // no ask_confirmation at all
    };
    const result = runValidationPipeline(plan, { platform: "ios", grantedPermissions: ["bluetooth", "tesla_account"] });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "unconfirmed_risky_action")).toBe(true);
  });

  it("never returns ok:true while any error-severity issue is present (fake success yasağı)", () => {
    const plan = { ...TESLA_SCENARIO, trigger: { type: "does.not.exist" } };
    const result = runValidationPipeline(plan, { platform: "ios", grantedPermissions: ["bluetooth", "tesla_account"] });
    const hasError = result.issues.some((i) => i.severity === "error");
    expect(hasError).toBe(true);
    expect(result.ok).toBe(false); // CLAUDE.md: "Testler başarısızsa 'tamamlandı' deme"
  });
});
