import { describe, expect, it } from "vitest";
import { BuilderMachine } from "../src/builder/machine.js";
import { InMemoryAutomationRepository, MockPermissionService, MockSetupService } from "../src/builder/mocks.js";
import { NluPlannerAdapter } from "../src/nlu/pipeline.js";

function fixture() {
  const planner = new NluPlannerAdapter();
  const repository = new InMemoryAutomationRepository();
  const machine = new BuilderMachine({
    planner, repository, platform: "ios",
    permissions: new MockPermissionService(["bluetooth", "tesla_account", "notifications"]),
    setup: new MockSetupService(),
  });
  return { planner, machine, repository };
}

describe("automation conversation isolation", () => {
  it("close clears an abandoned clarification and open starts a fresh attempt", async () => {
    const { planner, machine } = fixture();
    machine.open();
    machine.setText("Arabadan inince klimayı aç.");
    await machine.submit();
    expect(planner.getContext().conversationTurns).toHaveLength(1);
    machine.close();
    expect(planner.getContext().conversationTurns).toEqual([]);
    expect(planner.getContext().currentPlan).toBeNull();
    machine.open();
    machine.setText("Pil yüzde 20'ye düşünce bana haber ver.");
    await machine.submit();
    expect(planner.getContext().conversationTurns.map((t) => t.text)).toEqual([
      "Pil yüzde 20'ye düşünce bana haber ver.",
    ]);
    expect(machine.step.kind).toBe("understanding");
  });

  it("open clears existing context even when close was not called", async () => {
    const { planner, machine } = fixture();
    await planner.plan("Arabadan inince klimayı aç.");
    machine.open();
    expect(planner.getContext().conversationTurns).toEqual([]);
    expect(planner.getContext().currentPlan).toBeNull();
  });

  it("clarification and correction within an attempt preserve conversation through install", async () => {
    const { planner, machine, repository } = fixture();
    machine.open();
    machine.setText("Arabadan inince Sentry Mode'u aç.");
    await machine.submit();
    expect(planner.getContext().currentPlan?.missing[0]?.id).toBe("vehicle");
    machine.revise();
    machine.setText("Tesla Model Y.");
    await machine.submit();
    machine.revise();
    machine.setText("Hayır, Model 3.");
    await machine.submit();
    expect(planner.getContext().conversationTurns.map((t) => t.text)).toEqual([
      "Arabadan inince Sentry Mode'u aç.", "Tesla Model Y.", "Hayır, Model 3.",
    ]);
    expect(planner.getContext().currentPlan?.trigger.device).toBe("Tesla Model 3");
    await machine.confirmUnderstanding();
    await machine.create();
    await machine.prepareHandoff();
    machine.handOffToShortcuts();
    machine.confirmShortcutAdded();
    await machine.confirmTriggerLinked();
    expect(machine.step.kind).toBe("installed");
    expect((await repository.list())[0].installStatus).toBe("installed");
    expect(planner.getContext().conversationTurns).toHaveLength(3);
  });
});
