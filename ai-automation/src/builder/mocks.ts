/**
 * Phase 1 mock'ları — CLAUDE.md: "Gerçek cihaz entegrasyonu mümkün
 * değilse mock kullan ve bunu açıkça belirt."
 *
 * ⚠️ BUNLAR MOCK'TUR. Hiçbiri gerçek NLU, gerçek izin sistemi veya
 * gerçek Shortcuts kurulumu yapmaz. Port arayüzleri (ports.ts)
 * korunduğu sürece Phase 2/3'te gerçek implementasyonlarla
 * değiştirilebilirler; state machine ve UI değişmez.
 */

import type {
  AutomationRepository,
  PermissionService,
  Planner,
  PlannerResult,
  SetupService,
} from "./ports.js";
import type { DraftAutomationPlan } from "./types.js";
import type { Automation } from "../domain/types.js";

/**
 * MOCK planner. Gerçek Intent/Entity Extraction Phase 2'de gelecek.
 * Şu an yalnızca anahtar kelime eşlemesi yapar — bu bilinçli bir
 * mock'tur, NLU iddiası taşımaz.
 */
export class MockPlanner implements Planner {
  async plan(text: string, existingDraft?: DraftAutomationPlan | null): Promise<PlannerResult> {
    const t = text.toLocaleLowerCase("tr");

    const mentionsCar = /(arab|araç|tesla|bluetooth)/.test(t);
    const mentionsSentry = /(sentry|gözcü)/.test(t);
    const mentionsCamera = /(kamera|camera)/.test(t);
    const mentionsUnsupported = /(dron|çamaşır|uyduyu)/.test(t);

    // §7.1: revizyon — mevcut taslak varsa sıfırdan üretmek yerine
    // sadece değişen parçayı uygula.
    if (existingDraft && (mentionsSentry || mentionsCamera)) {
      const action = mentionsSentry ? "tesla.sentry_mode.toggle" : "tesla.camera_action";
      return {
        kind: "plan",
        plan: {
          ...existingDraft,
          name: mentionsSentry ? "Arabadan ayrılınca Sentry Mode" : "Arabadan ayrılınca kamera",
          steps: buildSteps(action, mentionsSentry),
        },
      };
    }

    // §7.3 testi için: registry'de olmayan bir capability üret.
    if (mentionsUnsupported) {
      return {
        kind: "plan",
        plan: {
          name: "Desteklenmeyen istek",
          trigger: { type: "ios.bluetooth.disconnected", device: null },
          steps: [{ type: "tesla.launch_drone" }],
          missing: [],
          answers: {},
        },
      };
    }

    if (mentionsCar && (mentionsSentry || mentionsCamera)) {
      const isSentry = mentionsSentry;
      const action = isSentry ? "tesla.sentry_mode.toggle" : "tesla.camera_action";
      const vehicleKnown = /(model y|model 3|model s|model x)/.test(t);
      return {
        kind: "plan",
        plan: {
          name: isSentry ? "Arabadan ayrılınca Sentry Mode" : "Arabadan ayrılınca kamera",
          trigger: {
            type: "ios.bluetooth.disconnected",
            device: vehicleKnown ? extractVehicle(t) : null,
          },
          steps: buildSteps(action, isSentry),
          missing: vehicleKnown
            ? []
            : [
                {
                  id: "vehicle",
                  kind: "device_or_person",
                  question: "Hangi Tesla'yı kullanalım?",
                  options: ["Model Y", "Model 3", "Model S", "Model X"],
                },
              ],
          answers: {},
        },
      };
    }

    // §7.2: hiçbir şey anlaşılamadı
    return { kind: "not_understood" };
  }
}

function buildSteps(actionType: string, isSentry: boolean) {
  const question = isSentry
    ? "Sentry Mode'u açmak ister misin?"
    : "Kamerayı açmak ister misin?";
  return [
    { type: "ask_confirmation" as const, message: question },
    {
      type: "conditional" as const,
      condition: "answer == yes",
      then: [{ type: actionType }],
      else: [],
    },
  ];
}

function extractVehicle(t: string): string {
  if (t.includes("model y")) return "Model Y";
  if (t.includes("model 3")) return "Model 3";
  if (t.includes("model s")) return "Model S";
  return "Model X";
}

/** MOCK izin servisi — gerçek OS izin API'leri Phase 3'te gelecek. */
export class MockPermissionService implements PermissionService {
  constructor(private granted: string[] = [], private autoGrant = true) {}
  async grantedPermissions(): Promise<string[]> {
    return [...this.granted];
  }
  async request(permission: string): Promise<boolean> {
    if (!this.autoGrant) return false;
    if (!this.granted.includes(permission)) this.granted.push(permission);
    return true;
  }
}

/** MOCK kurulum servisi — gerçek Shortcuts/App Intents adaptörü Phase 3. */
export class MockSetupService implements SetupService {
  constructor(private succeeds = true) {}
  async installNative(): Promise<{ installed: boolean }> {
    return { installed: this.succeeds };
  }
}

/** Bellek içi repository — gerçek storage/backend sonra gelecek. */
export class InMemoryAutomationRepository implements AutomationRepository {
  private items: Automation[] = [];
  constructor(seed: Automation[] = []) {
    this.items = [...seed];
  }
  async list(): Promise<Automation[]> {
    return [...this.items];
  }
  async save(automation: Automation): Promise<void> {
    this.items = [automation, ...this.items];
  }
  async setActive(id: string, active: boolean): Promise<void> {
    this.items = this.items.map((a) =>
      a.id === id ? { ...a, status: active ? "active" : "paused" } : a
    );
  }
}
