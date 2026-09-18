/**
 * Builder Flow state machine — docs/ux.md §1.2.
 *
 * Tüm geçişler burada; View'lar state'i doğrudan değiştirmez (docs/ux.md
 * §6.2). Platform bağımsız ve UI bağımsız olduğu için her geçiş unit test
 * edilebilir.
 *
 * Kritik kural (docs/ux.md §2): native vs guided setup ayrımı **asla**
 * UI'da veya burada hardcode edilmez — yalnızca
 * `Capability.nativeSupport` alanından okunur.
 */

import { flattenSteps, type AutomationPlan } from "../dsl/schema.js";
import { CAPABILITIES, PROGRAMMATIC_AUTOMATION_INSTALL, findCapability } from "../capability-registry/registry.js";
import { disclosuresFor, type DeviceContext } from "../capability-registry/resolver.js";
import { requiredInstallMethod } from "../compiler/contract.js";
import { validateCapabilities } from "../validators/capability-validator.js";
import type { Automation, Platform } from "../domain/types.js";
import type { AutomationRepository, PermissionService, Planner, SetupService } from "./ports.js";
import { nextMissingInfoQuestion } from "./missing-info.js";
import type { BuilderStep, DraftAutomationPlan, InstallStatus, SetupKind } from "./types.js";

export interface BuilderDeps {
  planner: Planner;
  permissions: PermissionService;
  setup: SetupService;
  repository: AutomationRepository;
  platform: Platform;
  /** Cihaz bağlamı; disclosure ve capability çözümlemesi için. */
  device?: DeviceContext;
  /** Test edilebilirlik için enjekte edilir. */
  now?: () => Date;
  idGenerator?: () => string;
}

export class BuilderMachine {
  private _step: BuilderStep = { kind: "idle" };
  private listeners: Array<(step: BuilderStep) => void> = [];

  constructor(private deps: BuilderDeps) {}

  get step(): BuilderStep {
    return this._step;
  }

  subscribe(listener: (step: BuilderStep) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private transition(step: BuilderStep): void {
    this._step = step;
    for (const l of this.listeners) l(step);
  }

  /* ---------------- idle <-> capturing ---------------- */

  /** FAB veya Ana Sayfa girişi: idle -> capturing */
  open(prefillText = ""): void {
    this.transition({ kind: "capturing", text: prefillText, draft: null, notUnderstood: false });
  }

  /** ✕ — akıştan tamamen çıkış, hiçbir şey kaydedilmez. */
  close(): void {
    this.transition({ kind: "idle" });
  }

  setText(text: string): void {
    if (this._step.kind !== "capturing") return;
    this.transition({ ...this._step, text, notUnderstood: false });
  }

  /* ---------------- capturing -> understanding ---------------- */

  /**
   * Gönder. Üç olası sonuç:
   *  - plan anlaşıldı ve capability'ler tanınıyor -> understanding
   *  - AI anlamadı -> capturing (notUnderstood: true), metin korunur (§7.2)
   *  - registry'de olmayan capability -> unsupported (§7.3)
   */
  async submit(): Promise<void> {
    if (this._step.kind !== "capturing") return;
    const { text, draft: existingDraft } = this._step;
    if (text.trim().length === 0) return;

    const result = await this.deps.planner.plan(text, existingDraft);

    if (result.kind === "not_understood") {
      this.transition({ kind: "capturing", text, draft: existingDraft, notUnderstood: true });
      return;
    }

    const draft = result.plan;

    const unknown = this.findUnknownCapability(draft);
    if (unknown) {
      this.transition({
        kind: "unsupported",
        draft,
        message: "Bunu şu anda otomatik olarak yapamıyorum.",
        alternatives: [],
      });
      return;
    }

    // Registry'de var ama Shortcuts'ta karşılığı yok: akışı durdurmak
    // yerine desteklenen alternatifleri öner (docs/ux.md §7.3).
    const unavailable = this.findUnavailableCapability(draft);
    if (unavailable) {
      this.transition({
        kind: "unsupported",
        draft,
        message: `Bunu doğrudan otomatik olarak kuramıyorum: ${unavailable.description.replace(/\.$/, "")} iPhone Shortcuts entegrasyonunda bulunmuyor.`,
        alternatives: this.alternativesFor(unavailable),
        manualSteps: unavailable.fallbackSteps,
      });
      return;
    }

    this.transition({ kind: "understanding", draft });
  }

  /** ✎ Değiştir — taslak korunarak capturing'e döner (§7.1: revize, sıfırlama değil). */
  revise(): void {
    if (this._step.kind !== "understanding" && this._step.kind !== "unsupported") return;
    this.transition({ kind: "capturing", text: "", draft: this._step.draft, notUnderstood: false });
  }

  /* ---------------- understanding -> missing_info | preview ---------------- */

  /** ✓ Doğru */
  async confirmUnderstanding(): Promise<void> {
    if (this._step.kind !== "understanding") return;
    await this.advanceAfterAnswers(this._step.draft);
  }

  /** Eksik bilgi ekranında bir cevap seçildi. */
  async answerMissingInfo(answer: string): Promise<void> {
    if (this._step.kind !== "missing_info") return;
    const { draft, question } = this._step;
    const updated: DraftAutomationPlan = {
      ...draft,
      answers: { ...draft.answers, [question.id]: answer },
      trigger:
        question.kind === "device_or_person"
          ? { ...draft.trigger, device: answer }
          : draft.trigger,
    };
    await this.advanceAfterAnswers(updated);
  }

  /** "Şimdilik geç" — yalnızca opsiyonel sorularda geçerli (§7.4). */
  async skipMissingInfo(): Promise<void> {
    if (this._step.kind !== "missing_info") return;
    const { draft, question } = this._step;
    if (!question.optional) return; // zorunlu soru atlanamaz
    const updated: DraftAutomationPlan = {
      ...draft,
      answers: { ...draft.answers, [question.id]: "" },
    };
    await this.advanceAfterAnswers(updated);
  }

  private async advanceAfterAnswers(draft: DraftAutomationPlan): Promise<void> {
    const question = nextMissingInfoQuestion(draft);
    if (question) {
      this.transition({ kind: "missing_info", draft, question });
      return;
    }
    const missingPermissions = await this.computeMissingPermissions(draft);
    this.transition({
      kind: "preview_confirm",
      draft,
      missingPermissions,
      disclosures: this.computeDisclosures(draft),
    });
  }

  /* ---------------- preview -> setup ---------------- */

  /** Düzenle — son eksik bilgi sorusuna, yoksa understanding'e döner. */
  edit(): void {
    if (this._step.kind !== "preview_confirm") return;
    const { draft } = this._step;
    const answered = draft.missing.filter((f) => draft.answers[f.id] !== undefined);
    const last = answered[answered.length - 1];
    if (last) {
      const reopened: DraftAutomationPlan = { ...draft, answers: { ...draft.answers } };
      delete reopened.answers[last.id];
      this.transition({ kind: "missing_info", draft: reopened, question: last });
      return;
    }
    this.transition({ kind: "understanding", draft });
  }

  /**
   * "Otomasyonu Oluştur" — docs/ux.md §2: bu tıklama, DSL'deki
   * `ask_confirmation` adımının ve Safety Validator'ın aradığı kullanıcı
   * onayının gerçek dünya karşılığıdır.
   *
   * Artık kurulum YAPMAZ; yalnızca kurulum paketini hazırlar. Kurulumun
   * kendisi kullanıcı onayı gerektirir (docs/capabilities.md §1.2).
   */
  async create(): Promise<void> {
    if (this._step.kind !== "preview_confirm") return;
    const { draft, missingPermissions } = this._step;

    for (const permission of missingPermissions) {
      const granted = await this.deps.permissions.request(permission);
      if (!granted) {
        const stillMissing = await this.computeMissingPermissions(draft);
        this.transition({
          kind: "preview_confirm",
          draft,
          missingPermissions: stillMissing,
          disclosures: this.computeDisclosures(draft),
        });
        return;
      }
    }

    this.transition({ kind: "setup", draft, setup: this.resolveSetupKind(draft) });
  }

  /**
   * Hazırlık bitti; kullanıcıya aktarılmaya hazır. `setup` durumunda
   * derleme/doğrulama yapılır, sonra kullanıcı onayı beklenir.
   */
  async prepareHandoff(): Promise<void> {
    if (this._step.kind !== "setup") return;
    const { draft, setup } = this._step;
    const prepared = await this.deps.setup.installNative(draft);
    if (!prepared.installed) {
      this.transition({
        kind: "setup_failed",
        draft,
        setup,
        reason: "Kurulum paketi hazırlanamadı.",
      });
      return;
    }
    this.transition({ kind: "user_assisted_import", draft, setup });
  }

  /**
   * "Kestirmelere Ekle" — kullanıcı Apple'ın kendi ekranına aktarılır.
   * Buradan İTİBAREN otomatik ilerleme YOKTUR: uygulama kurulumun
   * gerçekleştiğini bilemez, bu yüzden kullanıcının dönüp doğrulaması
   * beklenir.
   */
  handOffToShortcuts(): void {
    if (this._step.kind !== "user_assisted_import") return;
    this.transition({ kind: "waiting_for_user", draft: this._step.draft, setup: this._step.setup });
  }

  /**
   * Kullanıcı "Ekledim" dedi — kestirme Shortcuts kütüphanesinde.
   * Phase 3B Test 2 (gerçek cihaz): bu, otomasyon tetikleyicisinin
   * BAĞLANDIĞI anlamına GELMEZ — o programatik değil. Bu yüzden
   * `installed`'a değil `linking_trigger`'a geçilir.
   */
  confirmShortcutAdded(): void {
    if (this._step.kind !== "waiting_for_user") return;
    const { draft, setup } = this._step;
    this.transition({ kind: "linking_trigger", draft, setup, steps: this.triggerLinkingSteps(draft) });
  }

  /**
   * Kullanıcı "Bağladım" dedi — otomasyon tetikleyicisini Shortcuts'ın
   * Otomasyon sekmesinde elle bağladığını doğruladı. `user_assisted_import`
   * akışında `installed`'a girmenin TEK yolu budur (bkz.
   * `confirmGuidedSetupDone` — guided_manual için ayrı, tek adımlı yol).
   * MASTER_SPEC §18: sahte başarı üretilmez.
   */
  async confirmTriggerLinked(): Promise<void> {
    if (this._step.kind !== "linking_trigger") return;
    const { draft, setup } = this._step;
    const automation = this.buildAutomation(draft, setup, "installed");
    await this.deps.repository.save(automation);
    this.transition({ kind: "installed", automation });
  }

  /**
   * guided_manual akışı: Shortcuts'ta native karşılığı yok, kullanıcı
   * otomasyonun TAMAMINI (tetikleyici dahil) zaten elle kurdu — ayrı bir
   * `linking_trigger` adımına gerek yok, tek onay yeterli.
   */
  async confirmGuidedSetupDone(): Promise<void> {
    if (this._step.kind !== "setup" || this._step.setup.kind !== "guided_manual") return;
    const { draft, setup } = this._step;
    const automation = this.buildAutomation(draft, setup, "installed");
    await this.deps.repository.save(automation);
    this.transition({ kind: "installed", automation });
  }

  /** Kullanıcı kurulamadığını/bağlayamadığını bildirdi. Sahte başarı üretilmez. */
  reportInstallFailed(reason = "Kestirme kurulamadı."): void {
    if (
      this._step.kind !== "waiting_for_user" &&
      this._step.kind !== "user_assisted_import" &&
      this._step.kind !== "linking_trigger"
    )
      return;
    this.transition({ kind: "setup_failed", draft: this._step.draft, setup: this._step.setup, reason });
  }

  /** setup_failed -> tekrar dene (hazırlık aşamasına döner). */
  retrySetup(): void {
    if (this._step.kind !== "setup_failed") return;
    this.transition({ kind: "setup", draft: this._step.draft, setup: this._step.setup });
  }

  /** installed -> success (kutlama ekranı). Tek giriş yolu `installed`. */
  showSuccess(): void {
    if (this._step.kind !== "installed") return;
    this.transition({ kind: "success", automation: this._step.automation });
  }

  /**
   * Desteklenmeyen eylem yerine önerilen alternatifi seçer; plan revize
   * edilir ve akış `understanding`'e döner (docs/ux.md §7.3).
   */
  chooseAlternative(capabilityId: string): void {
    if (this._step.kind !== "unsupported") return;
    const cap = findCapability(capabilityId);
    if (!cap || cap.availableInShortcuts !== true) return;
    const draft = this.replaceActions(this._step.draft, capabilityId);
    this.transition({ kind: "understanding", draft });
  }

  /* ---------------- helpers ---------------- */

  private actionCapabilityIds(draft: DraftAutomationPlan): string[] {
    return flattenSteps(draft.steps)
      .map((s) => s.type)
      .filter((t) => t !== "ask_confirmation" && t !== "conditional");
  }

  private findUnknownCapability(draft: DraftAutomationPlan): string | null {
    const candidate: AutomationPlan = {
      name: draft.name,
      trigger: { type: draft.trigger.type, device: draft.trigger.device ?? undefined, params: draft.trigger.params },
      steps: draft.steps,
    };
    const result = validateCapabilities(candidate, { platform: this.deps.platform });
    const unknown = result.issues.find((i) => i.code === "unknown_capability");
    return unknown ? unknown.path ?? "unknown" : null;
  }

  private requiredPermissions(draft: DraftAutomationPlan): string[] {
    const ids = [draft.trigger.type, ...this.actionCapabilityIds(draft)];
    const perms = new Set<string>();
    for (const id of ids) {
      const cap = findCapability(id);
      if (cap) for (const p of cap.permissions) perms.add(p);
    }
    return Array.from(perms);
  }

  private async computeMissingPermissions(draft: DraftAutomationPlan): Promise<string[]> {
    const granted = new Set(await this.deps.permissions.grantedPermissions());
    return this.requiredPermissions(draft).filter((p) => !granted.has(p));
  }

  /**
   * Kurulum yöntemi YALNIZCA registry + compiler contract'tan okunur.
   * "automatic" asla üretilmez: programatik kurulum doğrulanmamıştır.
   */
  private resolveSetupKind(draft: DraftAutomationPlan): SetupKind {
    const plan: AutomationPlan = {
      name: draft.name,
      trigger: { type: draft.trigger.type, device: draft.trigger.device ?? undefined, params: draft.trigger.params },
      steps: draft.steps,
    };
    const method = requiredInstallMethod(plan);
    if (method === "guided_manual") {
      const cap = this.actionCapabilityIds(draft)
        .map((id) => findCapability(id))
        .find((c) => c?.installMethod === "guided_manual");
      return { kind: "guided_manual", steps: cap?.fallbackSteps ?? [cap?.fallbackMethod ?? ""] };
    }
    return { kind: "user_assisted_import" };
  }

  /**
   * Otomasyon tetikleyicisini Shortcuts'ın Otomasyon sekmesinde elle
   * bağlamak için adımlar. Registry'den (Phase 3B'de gerçek cihazda
   * kaydedilen akış) türetilir. Registry'de bu tetikleyici için
   * doğrulanmış adım yoksa, genel/doğrulanmamış bir patern kullanılır —
   * tek doğrulanmış örnek şu an `ios.bluetooth.disconnected` (Test 2).
   */
  private triggerLinkingSteps(draft: DraftAutomationPlan): string[] {
    const cap = findCapability(draft.trigger.type);
    return (
      cap?.triggerLinkingSteps ?? [
        "Kestirmeler uygulamasını aç, Otomasyon sekmesine geç",
        "Sağ üstten + ile yeni otomasyon oluştur, uygun tetikleyiciyi seç",
        "Eylem olarak az önce eklediğin kestirmeyi seç (yeniden kurmana gerek yok)",
      ]
    );
  }

  /** Registry'de var, ama Shortcuts'ta karşılığı olmayan eylem. */
  private findUnavailableCapability(draft: DraftAutomationPlan) {
    return this.actionCapabilityIds(draft)
      .map((id) => findCapability(id))
      .find((c) => c !== undefined && c.availableInShortcuts !== true);
  }

  /**
   * Desteklenmeyen bir eylem için aynı sağlayıcının desteklenen
   * eylemlerini önerir ("Kamera desteklenmiyor ama Sentry Mode
   * destekleniyor, bunu mu istersin?").
   */
  private alternativesFor(unavailable: { id: string }): Array<{ id: string; description: string }> {
    const namespace = unavailable.id.split(".")[0];
    return CAPABILITIES.filter(
      (c) =>
        c.kind === "action" &&
        c.platform === this.deps.platform &&
        c.availableInShortcuts === true &&
        c.id !== unavailable.id &&
        c.id.startsWith(namespace + ".")
    ).map((c) => ({ id: c.id, description: c.description }));
  }

  /** Plandaki eylem adımlarını verilen capability ile değiştirir. */
  private replaceActions(draft: DraftAutomationPlan, capabilityId: string): DraftAutomationPlan {
    const swap = (steps: typeof draft.steps): typeof draft.steps =>
      steps.map((s) => {
        if (s.type === "ask_confirmation") return s;
        if (s.type === "conditional" && "then" in s && "else" in s) {
          return { ...s, then: swap(s.then), else: swap(s.else) };
        }
        return { type: capabilityId };
      });
    const cap = findCapability(capabilityId);
    return {
      ...draft,
      name: cap ? cap.description.replace(/\.$/, "") : draft.name,
      steps: swap(draft.steps),
    };
  }

  /** Registry'den türeyen, kurulumdan önce kullanıcıya söylenecekler. */
  private computeDisclosures(draft: DraftAutomationPlan): string[] {
    const device: DeviceContext = this.deps.device ?? { osVersion: 26, hasCarPlay: false };
    const triggerCap = findCapability(draft.trigger.type);
    const out = triggerCap ? disclosuresFor(triggerCap, device) : [];
    if (PROGRAMMATIC_AUTOMATION_INSTALL.possible !== true) {
      out.push("iPhone güvenlik nedeniyle son kurulumu senin onaylamanı istiyor.");
    }
    return Array.from(new Set(out));
  }

  private buildAutomation(draft: DraftAutomationPlan, setup: SetupKind, installStatus: InstallStatus): Automation {
    const now = (this.deps.now ?? (() => new Date()))().toISOString();
    const id = (this.deps.idGenerator ?? (() => "auto-" + Math.random().toString(36).slice(2, 10)))();
    return {
      id,
      userId: "local",
      name: draft.name,
      platform: this.deps.platform,
      status: "active",
      trigger: draft.trigger,
      workflow: draft.steps,
      version: 1,
      createdAt: now,
      updatedAt: now,
      requiresGuidedSetup: setup.kind === "guided_manual",
      installStatus,
    };
  }
}
