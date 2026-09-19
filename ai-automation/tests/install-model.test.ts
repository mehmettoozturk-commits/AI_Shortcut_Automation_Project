/**
 * Kurulum modeli değişmezleri — Phase 1.5.
 *
 * Buradaki testler tek bir kuralı koruyor:
 *   `PROGRAMMATIC_AUTOMATION_INSTALL.possible !== true` olduğu sürece
 *   uygulama bir otomasyonun kurulduğunu KENDİ BAŞINA iddia edemez;
 *   `installed`/`success` durumlarına yalnızca gerçek kullanıcı
 *   doğrulamasıyla girilebilir.
 */

import { describe, expect, it } from "vitest";
import { BuilderMachine } from "../src/builder/machine.js";
import {
  InMemoryAutomationRepository,
  MockPermissionService,
  MockPlanner,
  MockSetupService,
} from "../src/builder/mocks.js";
import { CAPABILITIES, PROGRAMMATIC_AUTOMATION_INSTALL } from "../src/capability-registry/registry.js";
import { requiredInstallMethod } from "../src/compiler/contract.js";
import type { BuilderStep } from "../src/builder/types.js";

function makeMachine() {
  const repository = new InMemoryAutomationRepository();
  const machine = new BuilderMachine({
    planner: new MockPlanner(),
    permissions: new MockPermissionService(["bluetooth", "tesla_account"]),
    setup: new MockSetupService(true),
    repository,
    platform: "ios",
    device: { osVersion: 26, hasCarPlay: false },
  });
  return { machine, repository };
}

describe("Kurulum modeli: automatic asla varsayılmaz", () => {
  it("registry'de hiçbir satır automatic değil", () => {
    expect(PROGRAMMATIC_AUTOMATION_INSTALL.possible).not.toBe(true);
    expect(CAPABILITIES.some((c) => c.installMethod === "automatic")).toBe(false);
  });

  it("compiler contract hiçbir plan için automatic üretmez", () => {
    const plans = [
      { name: "a", trigger: { type: "ios.bluetooth.disconnected" }, steps: [{ type: "tesla.sentry_mode.toggle" }] },
      { name: "b", trigger: { type: "ios.time_of_day.daily" }, steps: [{ type: "ios.notification.show" }] },
      { name: "c", trigger: { type: "ios.carplay.disconnected" }, steps: [{ type: "tesla.camera_action" }] },
    ];
    for (const plan of plans) {
      expect(requiredInstallMethod(plan)).not.toBe("automatic");
    }
  });

  it("state machine'in ürettiği setup türleri yalnızca user_assisted_import veya guided_manual", async () => {
    const { machine } = makeMachine();
    machine.open();
    machine.setText("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç");
    await machine.submit();
    await machine.confirmUnderstanding();
    await machine.create();
    if (machine.step.kind === "setup") {
      expect(["user_assisted_import", "guided_manual"]).toContain(machine.step.setup.kind);
    }
  });
});

describe("Kurulum modeli: installed'a giden tek yol kullanıcı doğrulaması (Phase 3C-3)", () => {
  const reachable: BuilderStep["kind"][] = [];

  it("create() ERKEN bir kayıt oluşturur — ama 'pending_user' olarak, ASLA 'installed' değil", async () => {
    const { machine, repository } = makeMachine();
    machine.open();
    machine.setText("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç");
    await machine.submit();
    await machine.confirmUnderstanding();
    await machine.create();
    reachable.push(machine.step.kind);
    const saved = await repository.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.installStatus).toBe("pending_user");
  });

  it("prepareHandoff() kaydı hâlâ 'pending_user' bırakır (yeni kayıt oluşturmaz)", async () => {
    const { machine, repository } = makeMachine();
    machine.open();
    machine.setText("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç");
    await machine.submit();
    await machine.confirmUnderstanding();
    await machine.create();
    await machine.prepareHandoff();
    expect(machine.step.kind).toBe("user_assisted_import");
    const saved = await repository.list();
    expect(saved).toHaveLength(1); // aynı kayıt, çoğalmadı
    expect(saved[0]!.installStatus).toBe("pending_user");
  });

  it("handOffToShortcuts() kaydı hâlâ 'pending_user' bırakır (OS açsa bile — kullanıcı ne yaptı BİLİNMİYOR)", async () => {
    const { machine, repository } = makeMachine();
    machine.open();
    machine.setText("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç");
    await machine.submit();
    await machine.confirmUnderstanding();
    await machine.create();
    await machine.prepareHandoff();
    machine.handOffToShortcuts();
    const saved = await repository.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.installStatus).toBe("pending_user");
  });

  it("confirmShortcutAdded() ('Ekledim') TEK BAŞINA installed YAPMAZ — kayıt 'pending_user' kalır", async () => {
    const { machine, repository } = makeMachine();
    machine.open();
    machine.setText("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç");
    await machine.submit();
    await machine.confirmUnderstanding();
    await machine.create();
    await machine.prepareHandoff();
    machine.handOffToShortcuts();
    machine.confirmShortcutAdded();
    expect(machine.step.kind).toBe("linking_trigger");
    const saved = await repository.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.installStatus).toBe("pending_user");
  });

  it("yalnızca confirmTriggerLinked() (Ekledim + Bağladım'dan sonra) installStatus'u 'installed' yapar — AYNI kayıt güncellenir, çoğalmaz", async () => {
    const { machine, repository } = makeMachine();
    machine.open();
    machine.setText("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç");
    await machine.submit();
    await machine.confirmUnderstanding();
    await machine.create();
    await machine.prepareHandoff();
    machine.handOffToShortcuts();
    machine.confirmShortcutAdded();
    await machine.confirmTriggerLinked();
    const saved = await repository.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.installStatus).toBe("installed");
  });

  it("reportInstallFailed() ('Ekleyemedim'/'Bağlayamadım') kaydı 'failed' yapar — sessizce KAYBOLMAZ (Test 8)", async () => {
    const { machine, repository } = makeMachine();
    machine.open();
    machine.setText("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç");
    await machine.submit();
    await machine.confirmUnderstanding();
    await machine.create();
    await machine.prepareHandoff();
    machine.handOffToShortcuts();
    await machine.reportInstallFailed("Ekleyemedim");
    const saved = await repository.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.installStatus).toBe("failed");
  });

  it("'Template yok' hazırlık başarısızlığı 'failed' DEĞİL, 'pending_user' kalır (içerik eksikliği ≠ kesin başarısızlık)", async () => {
    const repository = new InMemoryAutomationRepository();
    const machine = new BuilderMachine({
      planner: new MockPlanner(),
      permissions: new MockPermissionService(["bluetooth", "tesla_account"]),
      setup: new MockSetupService(false), // "template/hazırlık yok" senaryosu
      repository,
      platform: "ios",
      device: { osVersion: 26, hasCarPlay: false },
    });
    machine.open();
    machine.setText("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç");
    await machine.submit();
    await machine.confirmUnderstanding();
    await machine.create();
    await machine.prepareHandoff();
    expect(machine.step.kind).toBe("setup_failed");
    const saved = await repository.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.installStatus).toBe("pending_user"); // failed DEĞİL
  });

  it("retrySetup() 'failed' bir kaydı yeniden 'pending_user'a döndürür (aktif yeniden deneme)", async () => {
    const { machine, repository } = makeMachine();
    machine.open();
    machine.setText("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç");
    await machine.submit();
    await machine.confirmUnderstanding();
    await machine.create();
    await machine.prepareHandoff();
    machine.handOffToShortcuts();
    await machine.reportInstallFailed("Ekleyemedim");
    expect((await repository.list())[0]!.installStatus).toBe("failed");
    await machine.retrySetup();
    const saved = await repository.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.installStatus).toBe("pending_user");
  });
});
