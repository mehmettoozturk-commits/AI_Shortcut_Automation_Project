import { describe, expect, it } from "vitest";
import { nextMissingInfoQuestion, pendingMissingInfo } from "../src/builder/missing-info.js";
import type { DraftAutomationPlan, MissingInfoField } from "../src/builder/types.js";

function draft(missing: MissingInfoField[], answers: Record<string, string> = {}): DraftAutomationPlan {
  return {
    name: "test",
    trigger: { type: "ios.bluetooth.disconnected" },
    steps: [{ type: "ask_confirmation", message: "?" }],
    missing,
    answers,
  };
}

const optionalPref: MissingInfoField = {
  id: "pref", kind: "optional_preference", question: "Bildirim sesi?", options: ["Aç","Kapat"], optional: true,
};
const actionDetail: MissingInfoField = {
  id: "detail", kind: "action_detail", question: "Ne yapılsın?", options: ["A","B"],
};
const device: MissingInfoField = {
  id: "vehicle", kind: "device_or_person", question: "Hangi araç?", options: ["Model Y"],
};
const trigger: MissingInfoField = {
  id: "when", kind: "trigger", question: "Ne zaman?", options: ["Sabah"],
};

describe("eksik bilgi öncelik sırası (docs/ux.md §7.4)", () => {
  it("sıra: tetikleyici -> cihaz/kişi -> eylem detayı -> opsiyonel", () => {
    // Bilinçli olarak ters sırada veriliyor
    const d = draft([optionalPref, actionDetail, device, trigger]);
    expect(pendingMissingInfo(d).map((f) => f.kind)).toEqual([
      "trigger",
      "device_or_person",
      "action_detail",
      "optional_preference",
    ]);
  });

  it("her seferinde tek soru döner", () => {
    const d = draft([device, trigger]);
    expect(nextMissingInfoQuestion(d)?.id).toBe("when");
  });

  it("cevaplanmış sorular tekrar sorulmaz", () => {
    const d = draft([trigger, device], { when: "Sabah" });
    expect(nextMissingInfoQuestion(d)?.id).toBe("vehicle");
  });

  it("hepsi cevaplandıysa null döner (preview'a geçiş sinyali)", () => {
    const d = draft([trigger, device], { when: "Sabah", vehicle: "Model Y" });
    expect(nextMissingInfoQuestion(d)).toBeNull();
  });

  it("aynı kategoride birden fazla varsa plandaki sıra korunur", () => {
    const a: MissingInfoField = { id:"a", kind:"action_detail", question:"A?", options:["1"] };
    const b: MissingInfoField = { id:"b", kind:"action_detail", question:"B?", options:["1"] };
    const d = draft([a, b]);
    expect(pendingMissingInfo(d).map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("boş liste null döner", () => {
    expect(nextMissingInfoQuestion(draft([]))).toBeNull();
  });
});
