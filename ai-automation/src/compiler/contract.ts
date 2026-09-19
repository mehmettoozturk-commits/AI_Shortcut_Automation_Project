/**
 * Compiler Contract — Phase 1.5.
 *
 * Bu dosya compiler'ı IMPLEMENTE ETMEZ; ne üretmek zorunda olduğunu
 * tanımlar. Phase 3'teki gerçek iOS adaptörü bu sözleşmeye uymak
 * zorundadır ve sözleşme testleri (checkRegistryContract) registry'nin
 * bu sözleşmeyi ihlal etmesini engeller.
 *
 * Sözleşmenin temel ilkesi (Phase 1.5 bulgusu):
 *   Üçüncü taraf bir uygulamanın kullanıcı adına tam bir kişisel
 *   otomasyon kurabildiği DOĞRULANMAMIŞTIR. Bu yüzden compiler'ın
 *   çıktısı "kurulmuş otomasyon" değil, "kurulabilir paket + kullanıcının
 *   yapması gereken adımlar"dır. Compiler asla "kuruldu" diyemez;
 *   yalnızca kurulum sonucunu bildirir.
 */

import type { AutomationPlan } from "../dsl/schema.js";
import { CAPABILITIES, PROGRAMMATIC_AUTOMATION_INSTALL, findCapability } from "../capability-registry/registry.js";
import { flattenSteps } from "../dsl/schema.js";
import type { Capability, InstallMethod } from "../capability-registry/types.js";
import type { DeviceContext } from "../capability-registry/resolver.js";

/* ---------------- compiler çıktısı ---------------- */

/** Shortcuts'a aktarılabilir otomasyon tarifi. */
export interface ShortcutsAutomationArtifact {
  kind: "shortcuts_automation";
  triggerCapabilityId: string;
  /** Kullanıcının Shortcuts'ta seçmesi gereken tetikleyici adı */
  triggerDisplayName: string;
  actions: Array<{ capabilityId: string; params?: Record<string, unknown> }>;
  /**
   * Otomasyonun "Ask Before Running" ayarı ne olmalı. `"must_ask"` ise
   * iOS zaten sormak zorunda; `"can_skip_asking"` ise kullanıcı
   * kapatabilir.
   */
  askBeforeRunning: "must_ask" | "can_skip_asking" | "unknown";
}

/** Kullanıcının elle yapacağı adımlar. */
export interface GuidedManualArtifact {
  kind: "guided_manual";
  reason: string;
  steps: string[];
}

export type CompiledArtifact = ShortcutsAutomationArtifact | GuidedManualArtifact;

export interface CompilationResult {
  artifacts: CompiledArtifact[];
  /** Kullanıcıya kurulumdan ÖNCE gösterilmesi gerekenler */
  disclosures: string[];
  /**
   * Kurulumun nasıl tamamlanacağı. `automatic` yalnızca registry'de
   * kanıtlanmışsa üretilebilir (şu an hiçbir satırda kanıtlı değil).
   */
  installMethod: InstallMethod;
  /** Compiler asla "kuruldu" demez; kurulum sonucu ayrı bildirilir. */
  claimsInstalled: false;
}

export interface Compiler {
  compile(plan: AutomationPlan, ctx: DeviceContext): CompilationResult;
}

/* ---------------- registry sözleşme denetimi ---------------- */

export interface ContractViolation {
  capabilityId: string;
  rule: string;
  detail: string;
}

/**
 * Registry'nin compiler sözleşmesini ihlal etmediğini denetler.
 * Bu fonksiyon testlerden çağrılır; yeni bir capability eklendiğinde
 * eksik/çelişkili alan varsa build kırmızıya döner.
 */
export function checkRegistryContract(capabilities: Capability[] = CAPABILITIES): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const seen = new Set<string>();

  for (const cap of capabilities) {
    const add = (rule: string, detail: string) =>
      violations.push({ capabilityId: cap.id, rule, detail });

    if (seen.has(cap.id)) add("unique_id", "Aynı id iki kez tanımlanmış");
    seen.add(cap.id);

    // 1. Native desteği olmayan her satır guided fallback tanımlamak zorunda.
    if (!cap.nativeSupport) {
      if (cap.installMethod !== "guided_manual") {
        add("fallback_required", "nativeSupport false ise installMethod guided_manual olmalı");
      }
      if (!cap.fallbackSteps || cap.fallbackSteps.length === 0) {
        add("fallback_required", "nativeSupport false ise fallbackSteps boş olamaz");
      }
    }

    // 2. "automatic" kurulum yalnızca kanıtlıysa kullanılabilir.
    if (cap.installMethod === "automatic" && PROGRAMMATIC_AUTOMATION_INSTALL.possible !== true) {
      add(
        "no_unproven_automatic_install",
        "Programatik otomasyon kurulumu doğrulanmadığı hâlde installMethod 'automatic' olarak işaretlenmiş"
      );
    }

    // 3. Her satır kaynak ve doğrulama tarihi taşımak zorunda.
    if (!cap.source || cap.source.length < 8) add("source_required", "Kaynak eksik");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cap.verifiedAt)) add("verified_at_format", "verifiedAt YYYY-MM-DD olmalı");

    // 4. Native destekli satırlar davranış kaydı taşımak zorunda
    //    (en azından "unverified" olarak işaretlenmiş bir kayıt).
    if (cap.nativeSupport && cap.behaviors.length === 0) {
      add("behavior_required", "Native destekli capability en az bir OSBehavior taşımalı");
    }

    // 5. Davranış kayıtları artan sürüm sırasında ve kaynaklı olmalı.
    let prev = -1;
    for (const b of cap.behaviors) {
      if (b.minOSVersion <= prev) add("behavior_order", "behaviors artan minOSVersion sırasında olmalı");
      prev = b.minOSVersion;
      if (!b.source) add("behavior_source", "Her OSBehavior kaynak taşımalı");
      if (b.canRunWithoutAsking === "unverified" && b.evidence !== "unverified" && !b.note) {
        add("unverified_needs_note", "Doğrulanmamış davranış bir not ile açıklanmalı");
      }
    }

    // 6. iOS'un onay soracağı bilinen satırlar, kullanıcıya bunu önceden
    //    söyleyebilmek için disclosure ya da davranış notu taşımalı.
    const mustAsk = cap.behaviors.some((b) => b.canRunWithoutAsking === false);
    if (mustAsk && (cap.userDisclosures?.length ?? 0) === 0 && cap.kind === "trigger") {
      add(
        "disclosure_required",
        "iOS'un ek onay soracağı bir tetikleyici, kullanıcıya önceden söylenecek bir disclosure taşımalı"
      );
    }

    // 7. Aynı gruptaki priority değerleri çakışmamalı.
    if (cap.triggerGroup && cap.priority === undefined) {
      add("priority_required", "triggerGroup tanımlıysa priority de tanımlı olmalı");
    }

    // 7b. Parametre şeması (Phase 3C-1, Test 5 bulgusu): enum tipi
    //     parametreler boş olmayan bir `allowed` listesi taşımalı, yoksa
    //     "somut değerle doldurulmalı" kuralı anlamsızlaşır.
    for (const param of cap.parameters ?? []) {
      if (param.type === "enum" && (!param.allowed || param.allowed.length === 0)) {
        add("parameter_schema_invalid", `Parametre "${param.name}" enum tipinde ama allowed listesi boş`);
      }
    }
  }

  // 8. Grup içi priority tekilliği.
  const groups = new Map<string, number[]>();
  for (const cap of capabilities) {
    if (!cap.triggerGroup || cap.priority === undefined) continue;
    const list = groups.get(cap.triggerGroup) ?? [];
    if (list.includes(cap.priority)) {
      violations.push({
        capabilityId: cap.id,
        rule: "priority_unique",
        detail: `"${cap.triggerGroup}" grubunda priority ${cap.priority} birden fazla kez kullanılmış`,
      });
    }
    list.push(cap.priority);
    groups.set(cap.triggerGroup, list);
  }

  return violations;
}

/**
 * Bir planın hangi kurulum yöntemini gerektirdiğini hesaplar.
 * En kısıtlayıcı yöntem kazanır: bir adım guided_manual gerektiriyorsa
 * tüm plan guided_manual olur.
 */
export function requiredInstallMethod(plan: AutomationPlan): InstallMethod {
  const ids = [
    plan.trigger.type,
    ...flattenSteps(plan.steps)
      .map((s) => s.type)
      .filter((t) => t !== "ask_confirmation" && t !== "conditional"),
  ];
  let method: InstallMethod = "user_assisted_import";
  for (const id of ids) {
    const cap = findCapability(id);
    if (cap?.installMethod === "guided_manual") return "guided_manual";
    if (cap?.installMethod === "app_intent_exposure") method = "app_intent_exposure";
  }
  return method;
}
