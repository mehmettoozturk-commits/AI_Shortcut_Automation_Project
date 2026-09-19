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

// Phase 3C-1 — Tesla parameter contract (Phase 3B Test 5 bulgusu):
// "Nöbetçi Modu" eylemi, parametresi sabit bir değere ayarlanmazsa
// otomasyon içinde bile interaktif soru sorup sessiz çalışmıyor. Bu
// yüzden capability-validator, parametreli bir eylemin gerekli her
// parametresini SOMUT bir değerle taşıdığını zorunlu kılar.
describe("validateCapabilities — parametre sözleşmesi (Phase 3C-1)", () => {
  const SENTRY_PLAN = {
    name: "Arabadan inince Sentry Mode",
    trigger: { type: "ios.bluetooth.disconnected", device: "Tesla Model Y" },
    steps: [
      { type: "ask_confirmation", message: "Sentry Mode'u açmak ister misin?" },
      {
        type: "conditional",
        condition: "answer == yes",
        then: [{ type: "tesla.sentry_mode.toggle", params: { mode: "enable" } }],
        else: [],
      },
    ],
  };

  it("gerekli parametre eksikse REDDEDİLİR", () => {
    const plan = parse({
      ...SENTRY_PLAN,
      steps: [
        { type: "ask_confirmation", message: "Sentry Mode'u açmak ister misin?" },
        {
          type: "conditional",
          condition: "answer == yes",
          then: [{ type: "tesla.sentry_mode.toggle" }], // params yok
          else: [],
        },
      ],
    });
    const result = validateCapabilities(plan, { platform: "ios" });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "missing_required_parameter")).toBe(true);
  });

  it("parametre 'Ask Each Time' anlamına gelen boş/null değerle REDDEDİLİR", () => {
    const plan = parse({
      ...SENTRY_PLAN,
      steps: [
        { type: "ask_confirmation", message: "Sentry Mode'u açmak ister misin?" },
        {
          type: "conditional",
          condition: "answer == yes",
          then: [{ type: "tesla.sentry_mode.toggle", params: { mode: null } }],
          else: [],
        },
      ],
    });
    const result = validateCapabilities(plan, { platform: "ios" });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "missing_required_parameter")).toBe(true);
  });

  it("izin verilmeyen bir parametre değeri REDDEDİLİR (AI 'mode: maybe' üretemez)", () => {
    const plan = parse({
      ...SENTRY_PLAN,
      steps: [
        { type: "ask_confirmation", message: "Sentry Mode'u açmak ister misin?" },
        {
          type: "conditional",
          condition: "answer == yes",
          then: [{ type: "tesla.sentry_mode.toggle", params: { mode: "maybe" } }],
          else: [],
        },
      ],
    });
    const result = validateCapabilities(plan, { platform: "ios" });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "invalid_parameter_value")).toBe(true);
  });

  it("geçerli, somut bir parametre değeri KABUL EDİLİR", () => {
    const result = validateCapabilities(parse(SENTRY_PLAN), { platform: "ios" });
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.code === "missing_required_parameter")).toBe(false);
    expect(result.issues.some((i) => i.code === "invalid_parameter_value")).toBe(false);
  });

  it("her iki izin verilen değer de (enable/disable) ayrı ayrı kabul edilir", () => {
    for (const mode of ["enable", "disable"]) {
      const plan = parse({
        ...SENTRY_PLAN,
        steps: [
          { type: "ask_confirmation", message: "Sentry Mode'u açmak ister misin?" },
          {
            type: "conditional",
            condition: "answer == yes",
            then: [{ type: "tesla.sentry_mode.toggle", params: { mode } }],
            else: [],
          },
        ],
      });
      const result = validateCapabilities(plan, { platform: "ios" });
      expect(result.ok).toBe(true);
    }
  });

  it("parametresiz capability'ler (örn. Bluetooth tetikleyici) bu kontrolden etkilenmez", () => {
    const result = validateCapabilities(parse(VALID_PLAN), { platform: "ios" });
    expect(result.issues.some((i) => i.code === "missing_required_parameter")).toBe(false);
  });
});
