import { beforeEach, describe, expect, it } from "vitest";
import { BuilderMachine } from "../src/builder/machine.js";
import {
  InMemoryAutomationRepository,
  MockPermissionService,
  MockPlanner,
  MockSetupService,
} from "../src/builder/mocks.js";
import type { BuilderStep } from "../src/builder/types.js";

const SENTRY = "Arabadan inince Tesla'nın Sentry Mode'unu aç";
const CAMERA = "Arabadan inince Tesla'nın kamerasını aç";

function makeMachine(opts: { granted?: string[]; autoGrant?: boolean; installSucceeds?: boolean } = {}) {
  const repository = new InMemoryAutomationRepository();
  const machine = new BuilderMachine({
    planner: new MockPlanner(),
    permissions: new MockPermissionService(opts.granted ?? ["bluetooth", "tesla_account"], opts.autoGrant ?? true),
    setup: new MockSetupService(opts.installSucceeds ?? true),
    repository,
    platform: "ios",
    now: () => new Date("2026-09-17T12:00:00Z"),
    idGenerator: () => "test-id",
  });
  return { machine, repository };
}

/** Sentry akışını preview_confirm'e kadar götürür. */
async function runToPreview(machine: BuilderMachine, text = SENTRY) {
  machine.open();
  machine.setText(text);
  await machine.submit();
  await machine.confirmUnderstanding();
  if (machine.step.kind === "missing_info") {
    await machine.answerMissingInfo("Model Y");
  }
}

/** preview -> installed: yeni kurulum akışının tamamı. */
async function runToInstalled(machine: BuilderMachine, text = SENTRY) {
  await runToPreview(machine, text);
  await machine.create();            // -> setup
  await machine.prepareHandoff();    // -> user_assisted_import
  machine.handOffToShortcuts();      // -> waiting_for_user
  await machine.confirmInstalledByUser(); // -> installed
}

describe("BuilderMachine — temel geçişler (docs/ux.md §1.2)", () => {
  let machine: BuilderMachine;
  beforeEach(() => {
    machine = makeMachine().machine;
  });

  it("idle ile başlar", () => {
    expect(machine.step.kind).toBe("idle");
  });

  it("open(): idle -> capturing", () => {
    machine.open();
    expect(machine.step.kind).toBe("capturing");
    if (machine.step.kind === "capturing") {
      expect(machine.step.text).toBe("");
      expect(machine.step.notUnderstood).toBe(false);
    }
  });

  it("open(prefill): kategori çipinden gelen metni doldurur", () => {
    machine.open("Arabadan inince ");
    if (machine.step.kind === "capturing") {
      expect(machine.step.text).toBe("Arabadan inince ");
    }
  });

  it("boş metinle submit() hiçbir geçiş yapmaz", async () => {
    machine.open();
    await machine.submit();
    expect(machine.step.kind).toBe("capturing");
  });

  it("submit(): capturing -> understanding", async () => {
    machine.open();
    machine.setText(SENTRY);
    await machine.submit();
    expect(machine.step.kind).toBe("understanding");
  });

  it("confirmUnderstanding(): araç bilinmiyorsa -> missing_info", async () => {
    machine.open();
    machine.setText(SENTRY);
    await machine.submit();
    await machine.confirmUnderstanding();
    expect(machine.step.kind).toBe("missing_info");
    if (machine.step.kind === "missing_info") {
      expect(machine.step.question.question).toContain("Hangi Tesla");
      expect(machine.step.question.options).toHaveLength(4);
    }
  });

  it("confirmUnderstanding(): araç cümlede geçiyorsa missing_info ATLANIR (§1.3)", async () => {
    machine.open();
    machine.setText("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç");
    await machine.submit();
    await machine.confirmUnderstanding();
    expect(machine.step.kind).toBe("preview_confirm");
  });

  it("answerMissingInfo(): missing_info -> preview_confirm ve cevap trigger.device'a yazılır", async () => {
    await runToPreview(machine);
    expect(machine.step.kind).toBe("preview_confirm");
    if (machine.step.kind === "preview_confirm") {
      expect(machine.step.draft.trigger.device).toBe("Model Y");
      expect(machine.step.missingPermissions).toEqual([]);
    }
  });

  it("create(): preview_confirm -> setup, kurulum yöntemi user_assisted_import", async () => {
    await runToPreview(machine);
    await machine.create();
    expect(machine.step.kind).toBe("setup");
    if (machine.step.kind === "setup") {
      // "automatic" ASLA üretilmez (docs/capabilities.md §1.2)
      expect(machine.step.setup.kind).toBe("user_assisted_import");
    }
  });

  it("tam kurulum akışı: setup -> user_assisted_import -> waiting_for_user -> installed", async () => {
    const { machine: m, repository } = makeMachine();
    await runToPreview(m);
    await m.create();
    expect(m.step.kind).toBe("setup");
    await m.prepareHandoff();
    expect(m.step.kind).toBe("user_assisted_import");
    m.handOffToShortcuts();
    expect(m.step.kind).toBe("waiting_for_user");
    expect(await repository.list()).toHaveLength(0); // henüz kaydedilmedi
    await m.confirmInstalledByUser();
    expect(m.step.kind).toBe("installed");
    const saved = await repository.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.installStatus).toBe("installed");
  });

  it("installed -> success yalnızca showSuccess() ile", async () => {
    const { machine: m } = makeMachine();
    await runToInstalled(m);
    m.showSuccess();
    expect(m.step.kind).toBe("success");
  });

  it("close(): her yerden idle'a döner ve hiçbir şey kaydetmez", async () => {
    const { machine: m, repository } = makeMachine();
    await runToPreview(m);
    m.close();
    expect(m.step.kind).toBe("idle");
    expect(await repository.list()).toHaveLength(0);
  });

  it("subscribe(): her geçişte dinleyiciye haber verir", async () => {
    const seen: BuilderStep["kind"][] = [];
    machine.subscribe((s) => seen.push(s.kind));
    machine.open();
    machine.setText(SENTRY);
    await machine.submit();
    expect(seen).toContain("capturing");
    expect(seen).toContain("understanding");
  });
});

describe("BuilderMachine — kurulum modeli değişmezleri", () => {
  it("waiting_for_user'dan OTOMATİK ilerleme yoktur: kullanıcı doğrulaması şart", async () => {
    const { machine, repository } = makeMachine();
    await runToPreview(machine);
    await machine.create();
    await machine.prepareHandoff();
    machine.handOffToShortcuts();
    // Hiçbir şey çağırmadan bekle: durum değişmemeli
    await new Promise((r) => setTimeout(r, 30));
    expect(machine.step.kind).toBe("waiting_for_user");
    expect(await repository.list()).toHaveLength(0);
  });

  it("success'e waiting_for_user'dan doğrudan atlanamaz", async () => {
    const { machine } = makeMachine();
    await runToPreview(machine);
    await machine.create();
    await machine.prepareHandoff();
    machine.handOffToShortcuts();
    machine.showSuccess(); // installed değil, yok sayılmalı
    expect(machine.step.kind).toBe("waiting_for_user");
  });

  it("kullanıcı kurulamadığını bildirirse setup_failed olur, kaydedilmez", async () => {
    const { machine, repository } = makeMachine();
    await runToPreview(machine);
    await machine.create();
    await machine.prepareHandoff();
    machine.handOffToShortcuts();
    machine.reportInstallFailed();
    expect(machine.step.kind).toBe("setup_failed");
    expect(await repository.list()).toHaveLength(0);
  });

  it("setup_failed -> retrySetup() -> setup", async () => {
    const { machine } = makeMachine();
    await runToPreview(machine);
    await machine.create();
    await machine.prepareHandoff();
    machine.handOffToShortcuts();
    machine.reportInstallFailed();
    machine.retrySetup();
    expect(machine.step.kind).toBe("setup");
  });

  it("hazırlık başarısız olursa setup_failed (sahte başarı yasağı, MASTER_SPEC §18)", async () => {
    const { machine, repository } = makeMachine({ installSucceeds: false });
    await runToPreview(machine);
    await machine.create();
    await machine.prepareHandoff();
    expect(machine.step.kind).toBe("setup_failed");
    expect(await repository.list()).toHaveLength(0);
  });

  it("preview_confirm, kurulumun kullanıcı onayı gerektirdiğini önceden söyler", async () => {
    const { machine } = makeMachine();
    await runToPreview(machine);
    if (machine.step.kind === "preview_confirm") {
      expect(machine.step.disclosures.some((d) => d.includes("senin onaylamanı istiyor"))).toBe(true);
    }
  });
});

describe("BuilderMachine — desteklenmeyen eylem ve alternatifler (docs/ux.md §7.3)", () => {
  it("kamera isteği unsupported'a düşer ve desteklenen Tesla alternatifleri sunulur", async () => {
    const { machine } = makeMachine();
    machine.open();
    machine.setText(CAMERA);
    await machine.submit();
    expect(machine.step.kind).toBe("unsupported");
    if (machine.step.kind === "unsupported") {
      const ids = machine.step.alternatives.map((a) => a.id);
      expect(ids).toContain("tesla.sentry_mode.toggle");
      expect(ids).not.toContain("tesla.camera_action");
      // Elle yapma adımları da korunur
      expect(machine.step.manualSteps?.[0]).toContain("Tesla uygulamasını aç");
    }
  });

  it("alternatif seçilince plan revize edilir ve understanding'e döner", async () => {
    const { machine } = makeMachine();
    machine.open();
    machine.setText(CAMERA);
    await machine.submit();
    machine.chooseAlternative("tesla.sentry_mode.toggle");
    expect(machine.step.kind).toBe("understanding");
    if (machine.step.kind === "understanding") {
      const json = JSON.stringify(machine.step.draft.steps);
      expect(json).toContain("tesla.sentry_mode.toggle");
      expect(json).not.toContain("tesla.camera_action");
    }
  });

  it("desteklenmeyen bir capability alternatif olarak seçilemez", async () => {
    const { machine } = makeMachine();
    machine.open();
    machine.setText(CAMERA);
    await machine.submit();
    machine.chooseAlternative("tesla.camera_action");
    expect(machine.step.kind).toBe("unsupported"); // reddedildi
  });

  it("alternatif seçildikten sonra akış sonuna kadar gidebilir", async () => {
    const { machine, repository } = makeMachine();
    machine.open();
    machine.setText(CAMERA);
    await machine.submit();
    machine.chooseAlternative("tesla.sentry_mode.toggle");
    await machine.confirmUnderstanding();
    if (machine.step.kind === "missing_info") await machine.answerMissingInfo("Model Y");
    await machine.create();
    await machine.prepareHandoff();
    machine.handOffToShortcuts();
    await machine.confirmInstalledByUser();
    expect(machine.step.kind).toBe("installed");
    expect((await repository.list())[0]!.installStatus).toBe("installed");
  });
});

describe("BuilderMachine — kapatılan 4 karar (docs/ux.md §7)", () => {
  it("§7.1 revise(): taslak korunur, sıfırlanmaz", async () => {
    const { machine } = makeMachine();
    machine.open();
    machine.setText(CAMERA);
    await machine.submit(); // -> unsupported (kamera desteklenmiyor)
    machine.revise();
    expect(machine.step.kind).toBe("capturing");
    if (machine.step.kind === "capturing") {
      expect(machine.step.draft).not.toBeNull();
      expect(machine.step.draft!.trigger.type).toBe("ios.bluetooth.disconnected");
    }
  });

  it("§7.1 revizyon planı siler değil günceller: kamera -> Sentry", async () => {
    const { machine } = makeMachine();
    machine.open();
    machine.setText(CAMERA);
    await machine.submit();
    machine.revise();
    machine.setText("Kamera değil, Sentry Mode'u aç");
    await machine.submit();
    expect(machine.step.kind).toBe("understanding");
    if (machine.step.kind === "understanding") {
      expect(JSON.stringify(machine.step.draft.steps)).toContain("tesla.sentry_mode.toggle");
      expect(JSON.stringify(machine.step.draft.steps)).not.toContain("tesla.camera_action");
    }
  });

  it("§7.2 anlaşılamayan girdi: capturing'de kalır, metin silinmez", async () => {
    const { machine } = makeMachine();
    machine.open();
    machine.setText("zzz qqq");
    await machine.submit();
    expect(machine.step.kind).toBe("capturing");
    if (machine.step.kind === "capturing") {
      expect(machine.step.notUnderstood).toBe(true);
      expect(machine.step.text).toBe("zzz qqq");
    }
  });

  it("§7.2 setText() sonrası notUnderstood temizlenir", async () => {
    const { machine } = makeMachine();
    machine.open();
    machine.setText("zzz qqq");
    await machine.submit();
    machine.setText(SENTRY);
    if (machine.step.kind === "capturing") {
      expect(machine.step.notUnderstood).toBe(false);
    }
  });

  it("§7.3 registry'de olmayan capability -> unsupported state", async () => {
    const { machine } = makeMachine();
    machine.open();
    machine.setText("Arabadan inince dronu kaldır");
    await machine.submit();
    expect(machine.step.kind).toBe("unsupported");
    if (machine.step.kind === "unsupported") {
      expect(machine.step.message).toContain("otomatik olarak yapamıyorum");
    }
  });

  it("§7.3 unsupported'dan revise() ile çıkış var (çıkmaz sokak değil)", async () => {
    const { machine } = makeMachine();
    machine.open();
    machine.setText("Arabadan inince dronu kaldır");
    await machine.submit();
    machine.revise();
    expect(machine.step.kind).toBe("capturing");
  });

  it("§7.3 bilinmeyen capability ile desteklenmeyen capability farklı ele alınır", async () => {
    // Bilinmeyen: alternatif sunulamaz
    const { machine: m1 } = makeMachine();
    m1.open();
    m1.setText("Arabadan inince dronu kaldır");
    await m1.submit();
    if (m1.step.kind === "unsupported") expect(m1.step.alternatives).toEqual([]);

    // Desteklenmeyen ama bilinen: alternatif sunulur
    const { machine: m2 } = makeMachine();
    m2.open();
    m2.setText(CAMERA);
    await m2.submit();
    if (m2.step.kind === "unsupported") expect(m2.step.alternatives.length).toBeGreaterThan(0);
  });
});

describe("BuilderMachine — izinler (docs/ux.md §3.5)", () => {
  it("izin eksikse preview_confirm bunu bildirir", async () => {
    const { machine } = makeMachine({ granted: [] });
    await runToPreview(machine);
    expect(machine.step.kind).toBe("preview_confirm");
    if (machine.step.kind === "preview_confirm") {
      expect(machine.step.missingPermissions).toContain("bluetooth");
      expect(machine.step.missingPermissions).toContain("tesla_account");
    }
  });

  it("izin verilirse create() setup'a geçer", async () => {
    const { machine } = makeMachine({ granted: [], autoGrant: true });
    await runToPreview(machine);
    await machine.create();
    expect(machine.step.kind).toBe("setup");
  });

  it("izin reddedilirse setup'a GEÇMEZ, preview'da kalır", async () => {
    const { machine } = makeMachine({ granted: [], autoGrant: false });
    await runToPreview(machine);
    await machine.create();
    expect(machine.step.kind).toBe("preview_confirm");
  });
});

describe("BuilderMachine — edit() geri dönüşü (docs/ux.md §3.5)", () => {
  it("cevaplanmış soru varsa o soruya döner", async () => {
    const { machine } = makeMachine();
    await runToPreview(machine);
    machine.edit();
    expect(machine.step.kind).toBe("missing_info");
    if (machine.step.kind === "missing_info") {
      expect(machine.step.question.id).toBe("vehicle");
    }
  });

  it("hiç soru yoksa understanding'e döner", async () => {
    const { machine } = makeMachine();
    machine.open();
    machine.setText("Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç");
    await machine.submit();
    await machine.confirmUnderstanding();
    machine.edit();
    expect(machine.step.kind).toBe("understanding");
  });
});
