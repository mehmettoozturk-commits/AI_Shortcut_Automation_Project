/**
 * AutomationRepository — Phase 3C-3.
 *
 * BuilderMachine artık `create()`'te erken bir kayıt oluşturup akış
 * boyunca AYNI id'yi güncelliyor (bkz. src/builder/machine.ts). Bu,
 * `save()`'in gerçek bir UPSERT olmasını zorunlu kılıyor — eskiden
 * (Phase 1) yalnızca prepend yapıyordu, aynı id iki kez save()
 * edilirse iki ayrı satır oluşurdu. Bu dosya bu düzeltmeyi doğrudan,
 * BuilderMachine'den bağımsız olarak kilitler.
 */

import { describe, expect, it } from "vitest";
import { InMemoryAutomationRepository } from "../src/builder/mocks.js";
import type { Automation } from "../src/domain/types.js";

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto-1",
    userId: "local",
    name: "Test otomasyon",
    platform: "ios",
    status: "active",
    trigger: { type: "ios.bluetooth.disconnected" },
    workflow: [],
    version: 1,
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
    requiresGuidedSetup: false,
    installStatus: "pending_user",
    ...overrides,
  };
}

describe("InMemoryAutomationRepository — upsert (Phase 3C-3)", () => {
  it("aynı id ile iki kez save() ÇOĞALTMAZ, günceller", async () => {
    const repo = new InMemoryAutomationRepository();
    await repo.save(makeAutomation({ installStatus: "pending_user" }));
    await repo.save(makeAutomation({ installStatus: "installed" }));
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.installStatus).toBe("installed");
  });

  it("farklı id'lerle save() ayrı kayıtlar oluşturur", async () => {
    const repo = new InMemoryAutomationRepository();
    await repo.save(makeAutomation({ id: "auto-1" }));
    await repo.save(makeAutomation({ id: "auto-2" }));
    const all = await repo.list();
    expect(all).toHaveLength(2);
    expect(all.map((a) => a.id).sort()).toEqual(["auto-1", "auto-2"]);
  });

  it("pending_user -> failed -> pending_user (retry) -> installed geçişlerinin hepsi AYNI kaydı günceller", async () => {
    const repo = new InMemoryAutomationRepository();
    await repo.save(makeAutomation({ installStatus: "pending_user" }));
    await repo.save(makeAutomation({ installStatus: "failed" }));
    await repo.save(makeAutomation({ installStatus: "pending_user" }));
    await repo.save(makeAutomation({ installStatus: "installed" }));
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.installStatus).toBe("installed");
  });

  it("\"uygulama kapat/aç\" simülasyonu: aynı verinin YENİ bir repository örneğine seed edilmesi durumu korur", async () => {
    const repoBeforeRestart = new InMemoryAutomationRepository();
    await repoBeforeRestart.save(makeAutomation({ installStatus: "installed" }));
    const savedState = await repoBeforeRestart.list();

    // "Restart": aynı diziyle YENİ bir repository örneği oluştur — gerçek
    // (dosya/disk tabanlı) bir repository'de bu, uygulamanın yeniden
    // açılıp aynı dosyayı okumasına karşılık gelir.
    const repoAfterRestart = new InMemoryAutomationRepository(savedState);
    const restored = await repoAfterRestart.list();
    expect(restored).toHaveLength(1);
    expect(restored[0]!.installStatus).toBe("installed");
    expect(restored[0]!.id).toBe(savedState[0]!.id);
  });

  it("setActive() var olan kaydı bulup günceller, çoğaltmaz", async () => {
    const repo = new InMemoryAutomationRepository([makeAutomation({ status: "active" })]);
    await repo.setActive("auto-1", false);
    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("paused");
  });
});
