/**
 * AppViewModel — View → ViewModel → Domain katmanlamasının orta katmanı.
 *
 * View (app.ts) hiçbir domain nesnesini doğrudan değiştirmez; her şey
 * buradan geçer. BuilderMachine'e dokunmadan tab/liste/toast gibi
 * uygulama seviyesi state'i yönetir.
 */

import { BuilderMachine } from "../builder/machine.js";
import {
  InMemoryAutomationRepository,
  MockPermissionService,
  MockPlanner,
  MockSetupService,
} from "../builder/mocks.js";
import type { AutomationRepository } from "../builder/ports.js";
import type { Automation } from "../domain/types.js";
import { findCapability } from "../capability-registry/registry.js";
import { flattenSteps } from "../dsl/schema.js";
import type { WorkflowStep } from "../dsl/schema.js";

export type TabId = "home" | "automations" | "templates" | "activity" | "settings";

export interface ActivityEntry {
  icon: "✅" | "⚠️" | "❌";
  title: string;
  time: string;
  retry?: boolean;
}

/** Karta basılacak görüntü bilgisi — capability registry'den türetilir. */
export interface AutomationDisplay {
  emoji: string;
  whenLabel: string;
  whatLabel: string;
  manual: boolean;
  active: boolean;
  /** Kurulum gerçekten doğrulandı mı? */
  installStatus: Automation["installStatus"];
}

const TRIGGER_LABELS: Record<string, string> = {
  "ios.bluetooth.disconnected": "Arabadan ayrılınca",
  "ios.carplay.disconnected": "Arabadan inince",
  "ios.time_of_day.daily": "Her gün belirlenen saatte",
};

const TRIGGER_EMOJI: Record<string, string> = {
  "ios.bluetooth.disconnected": "🚗",
  "ios.carplay.disconnected": "🚗",
  "ios.time_of_day.daily": "💊",
};

export function displayFor(a: Automation): AutomationDisplay {
  const triggerType = (a.trigger as { type?: string } | undefined)?.type ?? "";
  const steps = Array.isArray(a.workflow) ? (a.workflow as WorkflowStep[]) : [];
  const actionIds = flattenSteps(steps)
    .map((s) => s.type)
    .filter((t) => t !== "ask_confirmation" && t !== "conditional");
  const actionCap = actionIds.map((id) => findCapability(id)).find((c) => c !== undefined);

  return {
    emoji: TRIGGER_EMOJI[triggerType] ?? "⚡",
    whenLabel: TRIGGER_LABELS[triggerType] ?? "Belirlenen durumda",
    whatLabel: actionCap ? actionCap.description.replace(/\.$/, "") : "İşlem",
    manual: a.requiresGuidedSetup === true,
    active: a.status === "active",
    installStatus: a.installStatus,
  };
}

function seedAutomations(): Automation[] {
  const now = "2026-09-15T09:00:00Z";
  return [
    {
      id: "seed-tesla",
      userId: "local",
      name: "Tesla — Arabadan ayrılınca",
      platform: "ios",
      status: "active",
      trigger: { type: "ios.bluetooth.disconnected", device: "Model Y" },
      workflow: [
        { type: "ask_confirmation", message: "Sentry Mode'u açmak ister misin?" },
        { type: "conditional", condition: "answer == yes", then: [{ type: "tesla.sentry_mode.toggle" }], else: [] },
      ],
      version: 1,
      createdAt: now,
      updatedAt: now,
      requiresGuidedSetup: false,
      installStatus: "installed",
    },
    {
      id: "seed-med",
      userId: "local",
      name: "İlaç — 21:00 hatırlat",
      platform: "ios",
      status: "active",
      trigger: { type: "ios.time_of_day.daily", params: { time: "21:00" } },
      workflow: [{ type: "ios.notification.show" }],
      version: 1,
      createdAt: now,
      updatedAt: now,
      requiresGuidedSetup: false,
      installStatus: "installed",
    },
  ];
}

function seedActivity(): ActivityEntry[] {
  return [
    { icon: "✅", title: "İlaç hatırlatması gönderildi", time: "Dün 21:00" },
    { icon: "⚠️", title: "Tesla kamera adımı: manuel kurulum bekleniyor", time: "Dün 09:14" },
    { icon: "❌", title: "Tesla bağlantı hatası: Bluetooth bulunamadı", time: "3 gün önce", retry: true },
  ];
}

export class AppViewModel {
  tab: TabId = "home";
  openAutomationId: string | null = null;
  automations: Automation[] = [];
  activity: ActivityEntry[] = seedActivity();
  toast = "";
  listening = false;
  /** Prototip: hangi örnek senaryonun simüle edileceği (mikrofon metni için) */
  demoScenario: "sentry" | "camera" = "sentry";

  readonly machine: BuilderMachine;
  private repository: AutomationRepository;
  private listeners: Array<() => void> = [];
  private toastTimer: number | undefined;
  private typingTimer: number | undefined;

  constructor() {
    this.repository = new InMemoryAutomationRepository(seedAutomations());
    this.machine = new BuilderMachine({
      planner: new MockPlanner(),
      permissions: new MockPermissionService(["bluetooth", "notifications"]),
      setup: new MockSetupService(true),
      repository: this.repository,
      platform: "ios",
    });
    this.machine.subscribe(() => this.notify());
  }

  async load(): Promise<void> {
    this.automations = await this.repository.list();
    this.notify();
  }

  subscribe(listener: () => void): void {
    this.listeners.push(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  setTab(tab: TabId): void {
    this.tab = tab;
    this.openAutomationId = null;
    this.notify();
  }

  openDetail(id: string): void {
    this.openAutomationId = id;
    this.notify();
  }

  closeDetail(): void {
    this.openAutomationId = null;
    this.notify();
  }

  async toggleAutomation(id: string): Promise<void> {
    const current = this.automations.find((a) => a.id === id);
    if (!current) return;
    await this.repository.setActive(id, current.status !== "active");
    await this.load();
  }

  showToast(message: string): void {
    this.toast = message;
    this.notify();
    if (this.toastTimer !== undefined) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast = "";
      this.notify();
    }, 1700);
  }

  /** Ses girişi simülasyonu — canlı transkript (docs/ux.md §3.2). */
  simulateVoice(text: string): void {
    this.listening = true;
    this.notify();
    let i = 0;
    if (this.typingTimer !== undefined) window.clearInterval(this.typingTimer);
    this.typingTimer = window.setInterval(() => {
      i += 3;
      this.machine.setText(text.slice(0, i));
      if (i >= text.length) {
        window.clearInterval(this.typingTimer);
        this.listening = false;
        this.notify();
      }
    }, 28);
  }

  async finishBuilder(): Promise<void> {
    await this.load();
    this.machine.close();
    this.setTab("automations");
  }
}
