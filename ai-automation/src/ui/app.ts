/**
 * View katmanı. Kural (docs/ux.md §6.2): View state'i doğrudan
 * değiştirmez — yalnızca ViewModel/BuilderMachine metodlarını çağırır ve
 * `machine.step`'i render eder. Hiçbir ekranda platform capability
 * hardcode edilmez; native/guided ayrımı machine'den gelir.
 */

import { AppViewModel, displayFor, type TabId } from "./app-view-model.js";
import { S } from "./strings.js";
import type { Automation } from "../domain/types.js";
import type { BuilderStep, DraftAutomationPlan } from "../builder/types.js";
import { findCapability } from "../capability-registry/registry.js";
import { flattenSteps } from "../dsl/schema.js";
import type { WorkflowStep } from "../dsl/schema.js";

const SENTRY_DEMO = "Arabadan inince Tesla'nın Sentry Mode'unu aç";
const CAMERA_DEMO = "Arabadan inince Tesla'nın kamerasını aç";

const vm = new AppViewModel();

function esc(s: unknown): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/* ---------------- icons ---------------- */

const ICONS: Record<TabId, string> = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9"/></svg>',
  automations: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h11a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h11"/><path d="M15 3l3.5 4L15 11"/></svg>',
  templates: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M5.6 15.5a1.7 1.7 0 0 0-1.1-1.5H4.5a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.1-1.5 1.7 1.7 0 0 0-.3-1.9 2 2 0 1 1 2.8-2.8 1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 11.5 3h.9a1.7 1.7 0 0 0 1.1 2.1 1.7 1.7 0 0 0 1.9-.3 2 2 0 1 1 2.8 2.8 1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.5a2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.6 1 1.7 1.7 0 0 0 .3 1.9 2 2 0 1 1-2.8 2.8 1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1.1 1.6v.5a2 2 0 1 1-4 0 1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3 2 2 0 1 1-2.8-2.8 1.7 1.7 0 0 0 .3-1.9z"/></svg>',
};

/* ---------------- shared components ---------------- */

function automationCard(a: Automation): string {
  const d = displayFor(a);
  const badge =
    d.installStatus === "pending_user"
      ? `<span class="badge manual">${S.automationsExtra.pendingBadge}</span>`
      : d.installStatus === "failed"
        ? `<span class="badge manual">${S.automationsExtra.failedBadge}</span>`
        : d.manual
          ? `<span class="badge manual">${S.automations.manualBadge}</span>`
          : "";
  const toggleLabel = `${esc(a.name)} — ${d.active ? S.automations.on : S.automations.off}`;
  return `
    <div class="auto-card" data-action="open-automation" data-id="${a.id}" role="button" tabindex="0"
         aria-label="${esc(a.name)}">
      <div class="auto-emoji" aria-hidden="true">${d.emoji}</div>
      <div class="auto-info">
        <p class="auto-title">${esc(a.name)}${badge}</p>
        <p class="auto-sub">${esc(d.whenLabel)} · ${esc(d.whatLabel)}</p>
      </div>
      <button class="toggle${d.active ? " on" : ""}" data-action="toggle-automation" data-id="${a.id}"
              role="switch" aria-checked="${d.active}" aria-label="${toggleLabel}"></button>
    </div>`;
}

/** Planı kullanıcı diline çevirir — teknik id'ler asla gösterilmez. */
function planFlow(draft: DraftAutomationPlan): { when: string; question: string | null; action: string } {
  const triggerCap = findCapability(draft.trigger.type);
  const steps = flattenSteps(draft.steps as WorkflowStep[]);
  const ask = steps.find((s) => s.type === "ask_confirmation") as { message?: string } | undefined;
  const actionId = steps.map((s) => s.type).find((t) => t !== "ask_confirmation" && t !== "conditional");
  const actionCap = actionId ? findCapability(actionId) : undefined;
  return {
    when: triggerCap ? triggerCap.description.replace(/\.$/, "") : "Belirlenen durumda",
    question: ask?.message ?? null,
    action: actionCap ? actionCap.description.replace(/\.$/, "") : "İşlem",
  };
}

/* ---------------- tab screens ---------------- */

function renderHome(): string {
  const cats = S.categories
    .map(
      (c) =>
        `<button class="chip" data-action="category" data-prefill="${esc(c.prefill)}">${c.emoji} ${esc(c.label)}</button>`
    )
    .join("");
  const recent = vm.automations.slice(0, 3).map(automationCard).join("");
  return `
    <h1>${S.home.title}</h1>
    <p class="sub">${S.home.subtitle}</p>
    <div class="prompt-card" data-action="open-builder" role="button" tabindex="0" aria-label="${S.home.inputPlaceholder}">
      <div class="prompt-text placeholder">${S.home.inputPlaceholder}</div>
      <div class="prompt-actions">
        <span class="mic-btn" aria-hidden="true">🎙️ ${S.home.voice}</span>
        <span class="send-btn">${S.capturing.send}</span>
      </div>
    </div>
    <section style="margin-top:22px;">
      <p class="section-title">${S.home.categories}</p>
      <div class="chip-row">${cats}</div>
    </section>
    ${recent ? `<section><p class="section-title">${S.home.recent}</p>${recent}</section>` : ""}`;
}

function renderAutomations(): string {
  if (vm.openAutomationId) {
    const a = vm.automations.find((x) => x.id === vm.openAutomationId);
    if (a) return renderAutomationDetail(a);
  }
  if (vm.automations.length === 0) {
    return `
      <h1>${S.automations.title}</h1>
      <div class="empty">
        <p class="empty-title">${S.automations.emptyTitle}</p>
        <button class="btn btn-primary" data-action="tab" data-tab="home">${S.automations.emptyAction}</button>
      </div>`;
  }
  return `
    <h1>${S.automations.title}</h1>
    <p class="sub">${S.automations.subtitle}</p>
    ${vm.automations.map(automationCard).join("")}`;
}

function renderAutomationDetail(a: Automation): string {
  const d = displayFor(a);
  const steps = flattenSteps((Array.isArray(a.workflow) ? a.workflow : []) as WorkflowStep[]);
  const ask = steps.find((s) => s.type === "ask_confirmation") as { message?: string } | undefined;
  const runs = vm.activity
    .slice(0, 2)
    .map(
      (x) =>
        `<div class="act-row"><div class="act-icon" aria-hidden="true">${x.icon}</div><div class="act-body"><p class="act-title">${esc(x.title)}</p><p class="act-time">${esc(x.time)}</p></div></div>`
    )
    .join("");
  return `
    <button class="back-link" data-action="close-detail">← ${S.automations.back}</button>
    <h1 style="font-size:22px;">${esc(a.name)}</h1>
    <div class="auto-card" style="margin-top:14px;">
      <div class="auto-info"><p class="auto-title" style="margin:0;">${d.active ? S.automations.on : S.automations.off}</p></div>
      <button class="toggle${d.active ? " on" : ""}" data-action="toggle-automation" data-id="${a.id}"
              role="switch" aria-checked="${d.active}" aria-label="${esc(a.name)}"></button>
    </div>
    ${d.manual ? `<div class="guided-card" style="margin-top:12px;"><p>${S.automations.manualBadge}</p></div>` : ""}
    <section style="margin-top:18px;">
      <p class="section-title">${S.automations.detailWhen}</p>
      <div class="preview-card"><p class="pc-title" style="margin:0;">${esc(d.whenLabel)}</p></div>
      <p class="section-title" style="margin-top:14px;">${S.automations.detailWhat}</p>
      <div class="preview-card"><p class="pc-title" style="margin:0;">${esc(d.whatLabel)}</p></div>
      ${
        ask?.message
          ? `<p class="section-title" style="margin-top:14px;">${S.automations.detailConfirm}</p>
             <div class="preview-card"><p class="pc-title" style="margin:0;">"${esc(ask.message)}"</p></div>`
          : ""
      }
    </section>
    <section><p class="section-title">${S.automations.detailRuns}</p>${runs}</section>`;
}

function renderTemplates(): string {
  const rows = [
    { emoji: "🚗", text: "Arabadan inince bana sor", tag: "Otomatik kurulur", demo: SENTRY_DEMO },
    { emoji: "🚗", text: "Arabadan inince kamerayı aç", tag: "Son adımı sen yaparsın", demo: CAMERA_DEMO },
    { emoji: "🏠", text: "Eve gelince ışıkları aç", tag: S.soon },
    { emoji: "🔋", text: "Pil azalınca uyar", tag: S.soon },
    { emoji: "💊", text: "Her akşam ilaç hatırlat", tag: S.soon },
  ]
    .map(
      (t) =>
        `<div class="tmpl-row" role="button" tabindex="0" data-action="${t.demo ? "template" : "soon"}" data-demo="${esc(t.demo ?? "")}">
          <div class="tmpl-emoji" aria-hidden="true">${t.emoji}</div>
          <div class="tmpl-text">${esc(t.text)}</div>
          <div class="tmpl-tag">${esc(t.tag)}</div>
        </div>`
    )
    .join("");
  return `<h1>${S.templates.title}</h1><p class="sub">${S.templates.subtitle}</p>${rows}`;
}

function renderActivity(): string {
  const rows = vm.activity
    .map(
      (x) => `
      <div class="act-row">
        <div class="act-icon" aria-hidden="true">${x.icon}</div>
        <div class="act-body">
          <p class="act-title">${esc(x.title)}</p>
          <p class="act-time">${esc(x.time)}</p>
          ${x.retry ? `<button class="retry-link" data-action="retry">${S.setup.retry}</button>` : ""}
        </div>
      </div>`
    )
    .join("");
  return `<h1>${S.activity.title}</h1><p class="sub">${S.activity.subtitle}</p>${rows}`;
}

function renderSettings(): string {
  const rows = S.settings.rows
    .map(
      (r) =>
        `<div class="set-row" role="button" tabindex="0" data-action="soon"><span>${esc(r)}</span><span class="chev" aria-hidden="true">›</span></div>`
    )
    .join("");
  return `<h1>${S.settings.title}</h1><p class="sub">${S.settings.subtitle}</p>${rows}`;
}

/* ---------------- builder sheet ---------------- */

function renderBuilderBody(step: BuilderStep): string {
  switch (step.kind) {
    case "capturing": {
      const ready = step.text.trim().length > 0;
      const examples = step.notUnderstood
        ? `<div class="not-understood">
             <p>${S.capturing.notUnderstood}</p>
             <div class="chip-row" style="margin-top:12px;">
               ${S.capturing.examples.map((e) => `<button class="chip" data-action="example" data-prefill="${esc(e.replace("…", ""))}">${esc(e)}</button>`).join("")}
             </div>
           </div>`
        : "";
      return `
        <h2>${S.capturing.title}</h2>
        <div class="prompt-card">
          <div class="prompt-text${step.text ? "" : " placeholder"}">${esc(step.text) || S.home.inputPlaceholder}${
            vm.listening ? '<span class="listening-dot"></span>' : ""
          }</div>
          <div class="prompt-actions">
            <button class="mic-btn${vm.listening ? " listening" : ""}" data-action="mic"
                    aria-label="${S.home.voice}">${vm.listening ? S.capturing.listening : "🎙️ " + S.home.voice}</button>
            <button class="send-btn${ready ? " ready" : ""}" data-action="send"
                    ${ready ? "" : 'aria-disabled="true"'}>${S.capturing.send}</button>
          </div>
        </div>
        ${examples}
        <p class="sub" style="margin-top:16px;">${S.capturing.demoNote}</p>
        <div class="chip-row">
          <button class="chip wired" data-action="demo" data-demo="${esc(SENTRY_DEMO)}">${S.capturing.demoSentry}</button>
          <button class="chip wired" data-action="demo" data-demo="${esc(CAMERA_DEMO)}">${S.capturing.demoCamera}</button>
        </div>`;
    }

    case "understanding": {
      const f = planFlow(step.draft);
      const device = step.draft.trigger.device;
      return `
        <h2>${S.understanding.title}</h2>
        <div class="flow">
          <div class="flow-step">🚗 ${esc(f.when)}</div>
          <div class="flow-arrow" aria-hidden="true">↓</div>
          ${f.question ? `<div class="flow-step">❓ "${esc(f.question)}"</div><div class="flow-arrow" aria-hidden="true">↓</div>` : ""}
          <div class="flow-step">🛡️ ${esc(f.action)}</div>
          ${device ? `<p class="flow-device">${esc(String(device))}</p>` : ""}
        </div>
        <button class="btn btn-primary" data-action="confirm-understanding">${S.understanding.correct}</button>
        <button class="btn btn-secondary" data-action="revise">${S.understanding.change}</button>`;
    }

    case "unsupported": {
      const alts = step.alternatives
        .map(
          (a) =>
            `<button class="option" data-action="choose-alternative" data-capability="${esc(a.id)}"><span>${esc(a.description.replace(/\.$/, ""))}</span><span class="chev" aria-hidden="true">›</span></button>`
        )
        .join("");
      const manual = step.manualSteps?.length
        ? `<p class="sub">${S.unsupported.manualIntro}</p>
           <div class="guided-card"><ol class="guided-steps">${step.manualSteps
             .map((x, i) => `<li><span class="step-num">${i + 1}</span> ${esc(x)}</li>`)
             .join("")}</ol></div>`
        : "";
      return `
        <h2>${esc(step.message)}</h2>
        ${alts ? `<p class="sub">${S.unsupported.alternativesIntro}</p><div class="option-list">${alts}</div>` : ""}
        ${manual}
        <button class="btn btn-secondary" data-action="revise">${S.unsupported.revise}</button>`;
    }

    case "missing_info": {
      const opts = step.question.options
        .map(
          (o) =>
            `<button class="option" data-action="answer" data-answer="${esc(o)}"><span>${esc(o)}</span><span class="chev" aria-hidden="true">›</span></button>`
        )
        .join("");
      return `
        <h2>${esc(step.question.question)}</h2>
        <div class="option-list">${opts}</div>
        ${step.question.optional ? `<button class="btn btn-ghost" data-action="skip">${S.missingInfo.skip}</button>` : ""}`;
    }

    case "preview_confirm": {
      const f = planFlow(step.draft);
      const perms = step.missingPermissions
        .map((p) => S.preview.permissionNames[p] ?? p)
        .join(", ");
      const needsPerm = step.missingPermissions.length > 0;
      return `
        <h2>${S.preview.title}</h2>
        <div class="preview-card">
          <p class="pc-title">${esc(f.when)}${step.draft.trigger.device ? " (" + esc(String(step.draft.trigger.device)) + ")" : ""}</p>
          <ol>
            ${f.question ? `<li>Sana "${esc(f.question)}" sorulacak</li>` : ""}
            <li>Evet dersen: ${esc(f.action)}</li>
            <li>Hayır dersen hiçbir şey olmayacak</li>
          </ol>
        </div>
        ${needsPerm ? `<p class="permission-note">${S.preview.permissionNeeded(perms)}</p>` : ""}
        ${step.disclosures.length ? `<ul class="disclosures">${step.disclosures.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
        <button class="btn btn-primary" data-action="create">${
          needsPerm ? S.preview.createWithPermission : S.preview.create
        }</button>
        <button class="btn btn-secondary" data-action="edit">${S.preview.edit}</button>`;
    }

    case "setup": {
      if (step.setup.kind === "guided_manual") {
        const steps = step.setup.steps
          .map((x, i) => `<li><span class="step-num">${i + 1}</span> ${esc(x)}</li>`)
          .join("");
        return `
          <h2>${S.setup.guidedTitle}</h2>
          <div class="guided-card">
            <p>${S.setup.guidedWhy}</p>
            <ol class="guided-steps">${steps}</ol>
          </div>
          <button class="btn btn-primary" data-action="confirm-installed">${S.setup.guidedAck}</button>`;
      }
      return `
        <h2>${S.setup.preparingTitle}</h2>
        <div class="progress-list">
          <div class="progress-item"><div class="p-mark done" aria-hidden="true">✓</div> ${S.setup.steps[0]}</div>
          <div class="progress-item"><div class="p-mark done" aria-hidden="true">✓</div> ${S.setup.steps[1]}</div>
          <div class="progress-item"><div class="p-mark spin" aria-hidden="true"></div> ${S.setup.steps[2]}</div>
        </div>`;
    }

    case "user_assisted_import": {
      const f = planFlow(step.draft);
      return `
        <h2>${S.setup.readyTitle}</h2>
        <div class="preview-card">
          <p class="pc-title">${esc(f.when)}</p>
          <p style="margin:6px 0 0;font-size:14.5px;">🛡️ ${esc(f.action)}</p>
        </div>
        <p class="permission-note">${S.setup.handoffNote}</p>
        <button class="btn btn-primary" data-action="handoff">${S.setup.handoffButton}</button>`;
    }

    case "waiting_for_user":
      return `
        <h2>${S.setup.waitingTitle}</h2>
        <p class="sub">${S.setup.waitingNote}</p>
        <button class="btn btn-primary" data-action="confirm-installed">${S.setup.waitingConfirm}</button>
        <button class="btn btn-secondary" data-action="report-failed">${S.setup.waitingFailed}</button>`;

    case "installed":
      return `
        <div class="success-badge" aria-hidden="true">✅</div>
        <h2 style="margin-top:0;">${S.installed.title}</h2>
        <p class="sub">${S.installed.note}</p>
        <button class="btn btn-primary" data-action="show-success">${S.installed.continue}</button>`;

    case "setup_failed":
      return `
        <h2>${S.setup.failedTitle}</h2>
        <div class="guided-card"><p>${esc(step.reason)}</p></div>
        <button class="btn btn-primary" data-action="retry-setup">${S.setup.retry}</button>
        <button class="btn btn-secondary" data-action="close">Sonra devam ederim</button>`;

    case "success":
      return `
        <div class="success-badge" aria-hidden="true">🎉</div>
        <h2 style="margin-top:0;">${S.success.title}</h2>
        <p class="sub">"${esc(step.automation.name)}"</p>
        <button class="btn btn-primary" data-action="finish">${S.success.goToList}</button>`;

    default:
      return "";
  }
}

function stepIndex(step: BuilderStep): number {
  const map: Record<string, number> = {
    capturing: 0, understanding: 1, unsupported: 1, missing_info: 2, preview_confirm: 3,
    setup: 4, user_assisted_import: 4, waiting_for_user: 4, setup_failed: 4, installed: 4, success: 4,
  };
  return map[step.kind] ?? 0;
}

function renderSheet(): string {
  const step = vm.machine.step;
  const open = step.kind !== "idle";
  const idx = stepIndex(step);
  const dots = [0, 1, 2, 3, 4].map((i) => `<div class="dot${i <= idx ? " done" : ""}"></div>`).join("");
  return `
    <div class="sheet-backdrop${open ? " open" : ""}" data-action="backdrop">
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="sheet-head">
          <div class="dots" aria-hidden="true">${dots}</div>
          <button class="close-btn" data-action="close" aria-label="Kapat">✕</button>
        </div>
        <div class="sheet-body">${open ? renderBuilderBody(step) : ""}</div>
      </div>
    </div>`;
}

/* ---------------- root ---------------- */

const TABS: TabId[] = ["home", "automations", "templates", "activity", "settings"];

function screenFor(tab: TabId): string {
  switch (tab) {
    case "home": return renderHome();
    case "automations": return renderAutomations();
    case "templates": return renderTemplates();
    case "activity": return renderActivity();
    case "settings": return renderSettings();
  }
}

function render(): void {
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = `
    <div class="topbar">
      <div class="brand">${S.appName}</div>
      <div class="proto-pill">${S.protoBadge}</div>
    </div>
    <div class="screen">${screenFor(vm.tab)}</div>
    <button class="fab" data-action="open-builder" aria-label="${S.fab}">＋ ${S.fab}</button>
    <nav class="tabbar" aria-label="Ana gezinme">
      ${TABS.map(
        (t) => `<button class="tab${vm.tab === t ? " active" : ""}" data-action="tab" data-tab="${t}"
                        aria-current="${vm.tab === t ? "page" : "false"}">${ICONS[t]}<span>${S.tabs[t]}</span></button>`
      ).join("")}
    </nav>
    <div class="toast${vm.toast ? " show" : ""}" role="status">${esc(vm.toast)}</div>
    ${renderSheet()}`;
}

/* ---------------- events ---------------- */

async function handleAction(action: string, el: HTMLElement, target: EventTarget | null): Promise<void> {
  const m = vm.machine;
  switch (action) {
    case "tab": vm.setTab(el.dataset.tab as TabId); break;
    case "open-builder": m.open(); break;
    case "category": m.open(el.dataset.prefill ?? ""); break;
    case "example": m.setText(el.dataset.prefill ?? ""); break;
    case "demo": {
      const text = el.dataset.demo ?? "";
      if (m.step.kind !== "capturing") m.open(text);
      else m.setText(text);
      break;
    }
    case "template": m.open(el.dataset.demo ?? ""); break;
    case "mic": vm.simulateVoice(m.step.kind === "capturing" && m.step.text ? m.step.text : SENTRY_DEMO); break;
    case "send": await m.submit(); break;
    case "confirm-understanding": await m.confirmUnderstanding(); break;
    case "revise": m.revise(); break;
    case "answer": await m.answerMissingInfo(el.dataset.answer ?? ""); break;
    case "skip": await m.skipMissingInfo(); break;
    case "create":
      await m.create();
      // Hazırlık göstergesi görünsün diye kısa gecikme. Bu adım kurulum
      // YAPMAZ; yalnızca paketi hazırlar (docs/capabilities.md §1.2).
      if (m.step.kind === "setup" && m.step.setup.kind === "user_assisted_import") {
        window.setTimeout(() => { void m.prepareHandoff(); }, 1200);
      }
      break;
    case "handoff": m.handOffToShortcuts(); break;
    case "confirm-installed": await m.confirmInstalledByUser(); break;
    case "report-failed": m.reportInstallFailed(); break;
    case "retry-setup":
      m.retrySetup();
      if (m.step.kind === "setup" && m.step.setup.kind === "user_assisted_import") {
        window.setTimeout(() => { void m.prepareHandoff(); }, 1200);
      }
      break;
    case "show-success": m.showSuccess(); break;
    case "choose-alternative": m.chooseAlternative(el.dataset.capability ?? ""); break;
    case "edit": m.edit(); break;
    case "finish": await vm.finishBuilder(); break;
    case "close": m.close(); break;
    case "backdrop": if (target === el) m.close(); break;
    case "open-automation": vm.openDetail(el.dataset.id ?? ""); break;
    case "close-detail": vm.closeDetail(); break;
    case "toggle-automation": await vm.toggleAutomation(el.dataset.id ?? ""); break;
    case "soon": vm.showToast(S.soon); break;
    case "retry": vm.showToast("Yeniden deneniyor…"); break;
  }
}

document.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
  if (!el) return;
  void handleAction(el.dataset.action!, el, e.target);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[role="button"][data-action]');
  if (!el) return;
  e.preventDefault();
  void handleAction(el.dataset.action!, el, e.target);
});

vm.subscribe(render);
void vm.load().then(render);
render();
