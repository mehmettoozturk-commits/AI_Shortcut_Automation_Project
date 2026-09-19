import { describe, expect, it } from "vitest";
import { CAPABILITIES, PROGRAMMATIC_AUTOMATION_INSTALL, findCapability, capabilitiesInGroup } from "../src/capability-registry/registry.js";
import { behaviorFor, canRunWithoutAsking } from "../src/capability-registry/behavior.js";
import { disclosuresFor, resolveTrigger, type DeviceContext } from "../src/capability-registry/resolver.js";
import { checkRegistryContract, requiredInstallMethod } from "../src/compiler/contract.js";
import type { Capability } from "../src/capability-registry/types.js";

const ios26: DeviceContext = { osVersion: 26, hasCarPlay: false };
const ios17NoCarPlay: DeviceContext = { osVersion: 17, hasCarPlay: false };
const ios26CarPlay: DeviceContext = { osVersion: 26, hasCarPlay: true };

describe("OS sürümüne göre davranış (Phase 1.5 ana dersi)", () => {
  it("Bluetooth iOS 15'te onaysız ÇALIŞAMAZ", () => {
    const bt = findCapability("ios.bluetooth.disconnected")!;
    expect(canRunWithoutAsking(bt, 15)).toBe(false);
  });

  it("Bluetooth iOS 26'da onaysız çalışabilir", () => {
    const bt = findCapability("ios.bluetooth.disconnected")!;
    expect(canRunWithoutAsking(bt, 26)).toBe(true);
  });

  it("iOS 17 için iOS 15 kaydı geçerli kalır (doğrulanmamış aralık muhafazakâr davranır)", () => {
    const bt = findCapability("ios.bluetooth.disconnected")!;
    expect(canRunWithoutAsking(bt, 17)).toBe(false);
  });

  it("cihaz sürümü tüm kayıtların altındaysa 'unverified' döner, 'true' DÖNMEZ", () => {
    const bt = findCapability("ios.bluetooth.disconnected")!;
    expect(canRunWithoutAsking(bt, 14)).toBe("unverified");
  });

  it("Focus davranışı bilinmiyor olarak işaretli (tahmin edilmemiş)", () => {
    const focus = findCapability("ios.focus.changed")!;
    expect(canRunWithoutAsking(focus, 26)).toBe("unverified");
  });

  it("CarPlay her iki sürümde de onaysız çalışabilir", () => {
    const cp = findCapability("ios.carplay.disconnected")!;
    expect(canRunWithoutAsking(cp, 15)).toBe(true);
    expect(canRunWithoutAsking(cp, 26)).toBe(true);
  });

  it("behaviorFor en yüksek uygun kaydı seçer", () => {
    const bt = findCapability("ios.bluetooth.disconnected")!;
    expect(behaviorFor(bt, 26)?.minOSVersion).toBe(26);
    expect(behaviorFor(bt, 18)?.minOSVersion).toBe(15);
  });
});

describe("Capability resolver — üç seviyeli araç yaklaşımı", () => {
  it("CarPlay varsa CarPlay seçilir (priority 1)", () => {
    const r = resolveTrigger("vehicle_departure", ios26CarPlay);
    expect(r?.capability.id).toBe("ios.carplay.disconnected");
  });

  it("CarPlay yoksa Bluetooth'a düşer (priority 2) ve nedenini kaydeder", () => {
    const r = resolveTrigger("vehicle_departure", ios26);
    expect(r?.capability.id).toBe("ios.bluetooth.disconnected");
    expect(r?.rejected.some((x) => x.id === "ios.carplay.disconnected")).toBe(true);
  });

  it("konum alternatifi kullanıcı açıkça seçmedikçe kullanılmaz", () => {
    const r = resolveTrigger("vehicle_departure", { osVersion: 26, hasCarPlay: false, allowsAlwaysLocation: true });
    expect(r?.capability.id).toBe("ios.bluetooth.disconnected");
  });

  it("kullanıcı konum tercih ederse ve izin varsa konum seçilebilir", () => {
    const r = resolveTrigger("vehicle_departure", {
      osVersion: 26, hasCarPlay: false, allowsAlwaysLocation: true, prefersLocationTrigger: true,
    });
    // Bluetooth hâlâ priority 2 olduğu için önce o gelir; konum ancak
    // Bluetooth elenirse seçilir. Bu bilinçli: konum eşdeğer değil.
    expect(r?.capability.id).toBe("ios.bluetooth.disconnected");
  });

  it("grup priority sırasına göre sıralanır", () => {
    const ids = capabilitiesInGroup("vehicle_departure").map((c) => c.id);
    expect(ids).toEqual([
      "ios.carplay.disconnected",
      "ios.bluetooth.disconnected",
      "ios.location.leave",
    ]);
  });

  it("bilinmeyen grup için null döner", () => {
    expect(resolveTrigger("olmayan_grup", ios26)).toBeNull();
  });
});

describe("Disclosure üretimi — iki onay sürpriz olmamalı", () => {
  it("iOS 17 + Bluetooth: ek onay uyarısı üretilir", () => {
    const bt = findCapability("ios.bluetooth.disconnected")!;
    const d = disclosuresFor(bt, ios17NoCarPlay);
    expect(d.some((x) => x.includes("ayrıca onay soracak"))).toBe(true);
  });

  it("iOS 26 + Bluetooth: ek onay uyarısı üretilmez", () => {
    const bt = findCapability("ios.bluetooth.disconnected")!;
    const d = disclosuresFor(bt, ios26);
    expect(d.some((x) => x.includes("ayrıca onay soracak"))).toBe(false);
  });

  it("doğrulanmamış davranış için dürüst bir belirsizlik uyarısı üretilir", () => {
    const focus = findCapability("ios.focus.changed")!;
    const d = disclosuresFor(focus, ios26);
    expect(d.some((x) => x.includes("kesin olarak bilmiyoruz"))).toBe(true);
  });

  it("konum alternatifi eşdeğer olmadığını söyler", () => {
    const loc = findCapability("ios.location.leave")!;
    const d = disclosuresFor(loc, ios26);
    expect(d.some((x) => x.includes("birebir eşdeğeri değildir"))).toBe(true);
  });

  it("her capability kurulumun son adımını kullanıcının yapacağını söyler", () => {
    const cp = findCapability("ios.carplay.disconnected")!;
    expect(disclosuresFor(cp, ios26CarPlay).some((x) => x.includes("son adımını senin onaylaman"))).toBe(true);
  });
});

describe("Compiler contract — registry değişmezleri", () => {
  it("mevcut registry sözleşmeyi ihlal etmiyor", () => {
    const violations = checkRegistryContract();
    expect(violations).toEqual([]);
  });

  it("programatik kurulum doğrulanmadığı için hiçbir satır 'automatic' olamaz", () => {
    expect(PROGRAMMATIC_AUTOMATION_INSTALL.possible).not.toBe(true);
    expect(CAPABILITIES.every((c) => c.installMethod !== "automatic")).toBe(true);
  });

  it("kanıtlanmamış 'automatic' işaretini yakalar", () => {
    const bad: Capability = { ...findCapability("ios.time_of_day.daily")!, id: "bad.auto", installMethod: "automatic" };
    const violations = checkRegistryContract([bad]);
    expect(violations.some((v) => v.rule === "no_unproven_automatic_install")).toBe(true);
  });

  it("native desteği olmayıp fallback adımı vermeyen satırı yakalar", () => {
    const bad: Capability = {
      ...findCapability("tesla.camera_action")!, id: "bad.nofallback", fallbackSteps: [],
    };
    expect(checkRegistryContract([bad]).some((v) => v.rule === "fallback_required")).toBe(true);
  });

  it("davranış kaydı olmayan native satırı yakalar", () => {
    const bad: Capability = { ...findCapability("ios.time_of_day.daily")!, id: "bad.nobehavior", behaviors: [] };
    expect(checkRegistryContract([bad]).some((v) => v.rule === "behavior_required")).toBe(true);
  });

  it("grup içi çakışan priority'yi yakalar", () => {
    const a = findCapability("ios.carplay.disconnected")!;
    const b: Capability = { ...findCapability("ios.bluetooth.disconnected")!, priority: 1 };
    expect(checkRegistryContract([a, b]).some((v) => v.rule === "priority_unique")).toBe(true);
  });

  it("kaynaksız satırı yakalar", () => {
    const bad: Capability = { ...findCapability("ios.time_of_day.daily")!, id: "bad.nosource", source: "" };
    expect(checkRegistryContract([bad]).some((v) => v.rule === "source_required")).toBe(true);
  });

  it("iOS'un onay soracağı tetikleyicinin disclosure taşımasını zorunlu kılar", () => {
    const bad: Capability = {
      ...findCapability("ios.bluetooth.disconnected")!, id: "bad.nodisclosure", userDisclosures: [],
    };
    expect(checkRegistryContract([bad]).some((v) => v.rule === "disclosure_required")).toBe(true);
  });

  // Phase 3C-1: Tesla'nın gerçek registry satırı (mode: enable/disable)
  // sözleşmeyi ihlal etmiyor; boş `allowed` listesi ihlal SAYILIR.
  it("Tesla Sentry Mode'un gerçek parametre şeması sözleşmeyi ihlal etmiyor", () => {
    const tesla = findCapability("tesla.sentry_mode.toggle")!;
    expect(tesla.parameters?.length).toBeGreaterThan(0);
    expect(checkRegistryContract([tesla])).toEqual([]);
  });

  it("enum parametrenin boş 'allowed' listesini yakalar", () => {
    const cap = findCapability("tesla.sentry_mode.toggle")!;
    const bad: Capability = {
      ...cap, id: "bad.emptyenum",
      parameters: [{ name: "mode", type: "enum", required: true, allowed: [] }],
    };
    expect(checkRegistryContract([bad]).some((v) => v.rule === "parameter_schema_invalid")).toBe(true);
  });

  // Phase 4E-2: `displayDescription` — kullanıcıya SwiftUI'da gösterilen,
  // capability id İÇERMEYEN doğal dil açıklaması.
  it("boş displayDescription'ı yakalar", () => {
    const bad: Capability = { ...findCapability("ios.bluetooth.disconnected")!, id: "bad.emptydisplay", displayDescription: "" };
    expect(checkRegistryContract([bad]).some((v) => v.rule === "display_description_required")).toBe(true);
  });

  it("yalnızca boşluklardan oluşan displayDescription'ı da yakalar", () => {
    const bad: Capability = { ...findCapability("ios.bluetooth.disconnected")!, id: "bad.blankdisplay", displayDescription: "   " };
    expect(checkRegistryContract([bad]).some((v) => v.rule === "display_description_required")).toBe(true);
  });

  it("capability id'sini İÇEREN bir displayDescription'ı yakalar (id sızıntısı)", () => {
    const bad: Capability = {
      ...findCapability("ios.bluetooth.disconnected")!,
      id: "bad.leakydisplay",
      displayDescription: "bad.leakydisplay tetiklendiğinde",
    };
    expect(checkRegistryContract([bad]).some((v) => v.rule === "display_description_no_id")).toBe(true);
  });

  it("her gerçek capability'nin geçerli, boş olmayan bir displayDescription'ı var (registry çapında)", () => {
    for (const cap of CAPABILITIES) {
      expect(cap.displayDescription.trim().length, cap.id).toBeGreaterThan(0);
      expect(cap.displayDescription, cap.id).not.toContain(cap.id);
    }
  });
});

describe("Compiler contract — kurulum yöntemi hesabı", () => {
  const base = {
    name: "test",
    trigger: { type: "ios.bluetooth.disconnected" },
  };

  it("Sentry planı kullanıcı onaylı içe alma gerektirir (otomatik DEĞİL)", () => {
    const method = requiredInstallMethod({
      ...base,
      steps: [
        { type: "ask_confirmation", message: "?" },
        { type: "conditional", condition: "answer == yes", then: [{ type: "tesla.sentry_mode.toggle" }], else: [] },
      ],
    });
    expect(method).toBe("user_assisted_import");
  });

  it("kamera planı guided_manual'a düşer (en kısıtlayıcı yöntem kazanır)", () => {
    const method = requiredInstallMethod({
      ...base,
      steps: [
        { type: "ask_confirmation", message: "?" },
        { type: "conditional", condition: "answer == yes", then: [{ type: "tesla.camera_action" }], else: [] },
      ],
    });
    expect(method).toBe("guided_manual");
  });
});
