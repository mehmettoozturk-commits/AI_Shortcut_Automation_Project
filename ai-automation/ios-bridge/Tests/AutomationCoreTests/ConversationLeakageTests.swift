import XCTest
@testable import AutomationCore

/// `HTTPBackedPlannerTests.swift`'teki `FakeTransport`in bağımsız bir
/// kopyası — o dosyadaki tip `private`, buradan erişilemiyor. Aynı,
/// önceden hazırlanmış (statusCode, body) yanıtları sırayla döner ve
/// gönderilen her istek gövdesini kaydeder.
private actor ScriptedTransport: PlanHTTPTransport {
    private var responses: [PlanHTTPResult]
    private(set) var receivedBodies: [Data] = []
    private var index = 0

    init(responses: [PlanHTTPResult]) { self.responses = responses }

    func send(requestBody: Data) async throws -> PlanHTTPResult {
        receivedBodies.append(requestBody)
        guard index < responses.count else { throw URLError(.unknown) }
        defer { index += 1 }
        return responses[index]
    }
}

private func jsonData(_ string: String) -> Data { Data(string.utf8) }
private func jsonObject(_ data: Data) -> [String: Any]? {
    (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
}

@MainActor
final class ConversationLeakageTests: XCTestCase {
    /// Abandon a clarification, start an unrelated attempt, and install it in isolation.
    func testAbandonedAttempt_newAttemptHasFreshConversation_reachesInstalled() async throws {
        let registry = try CapabilityRegistry.loadFromBundle()

        // Attempt 1: "Arabadan inince klimayı aç." -> araç sorusu.
        let attempt1Response = jsonData("""
        {
          "status": "needs_clarification",
          "conversation": {
            "marker": "attempt1-abandoned",
            "currentPlan": {
              "name": "Klimayı/ön ısıtmasını başlatır",
              "trigger": { "type": "ios.bluetooth.disconnected", "device": null, "params": {} },
              "steps": [ { "type": "tesla.climate.start" } ],
              "missing": [ { "id": "vehicle", "kind": "device_or_person", "question": "Hangi aracı kullanalım?", "options": ["Tesla Model Y", "Tesla Model 3"], "optional": false } ],
              "answers": {}
            }
          }
        }
        """)

        // Attempt 2: TAMAMEN alakasız, farklı bir otomasyon — hiçbir
        // eksik bilgi yok, doğrudan plan.
        let attempt2Response = jsonData("""
        {
          "status": "plan",
          "plan": {
            "name": "Kullanıcıya bir bildirim gösterir",
            "trigger": { "type": "ios.battery.falls_below", "device": null, "params": {} },
            "steps": [ { "type": "ios.notification.show" } ],
            "missing": [],
            "answers": {}
          },
          "conversation": { "marker": "attempt2" }
        }
        """)

        let transport = ScriptedTransport(responses: [
            PlanHTTPResult(statusCode: 200, body: attempt1Response),
            PlanHTTPResult(statusCode: 200, body: attempt2Response),
        ])
        let permissions = MockPermissionService(granted: ["bluetooth", "tesla_account", "notifications"])
        let planner = HTTPBackedPlanner(transport: transport, permissions: permissions)
        let repository = InMemoryAutomationRepository()
        let machine = BuilderMachine(
            registry: registry,
            planner: planner,
            permissions: permissions,
            setup: MockSetupService(),
            shortcutsHandoff: MockShortcutsHandoff(),
            repository: repository,
            device: DeviceContext(osVersion: 26, hasCarPlay: false)
        )

        // --- Attempt 1: araç sorusuna kadar git, sonra TERK ET ---
        await machine.open()
        machine.setText("Arabadan inince klimayı aç.")
        await machine.submit()
        guard case .understanding = machine.step else { return XCTFail("understanding bekleniyordu") }
        await machine.confirmUnderstanding()
        guard case .missingInfo = machine.step else { return XCTFail("missingInfo (araç sorusu) bekleniyordu") }

        // Kullanıcı cevaplamadan vazgeçti — ✕ ile çıktı.
        await machine.close()
        guard case .idle = machine.step else { return XCTFail("idle bekleniyordu") }

        // --- Attempt 2: TAMAMEN alakasız yeni bir otomasyon ---
        await machine.open()
        machine.setText("Pil yüzde 20'ye düşünce bana haber ver")
        await machine.submit()

        // The new request must carry no conversation from the abandoned attempt.
        let bodies = await transport.receivedBodies
        XCTAssertEqual(bodies.count, 2)
        let sentConversation2 = jsonObject(bodies[1])?["conversation"] as? [String: Any]
        XCTAssertNil(sentConversation2, "A new attempt must not send the abandoned conversation")

        // --- Akış devam ediyor mu, yoksa bir yerde durup uyarıyor mu? ---
        guard case .understanding = machine.step else { return XCTFail("understanding bekleniyordu") }
        await machine.confirmUnderstanding()
        guard case .previewConfirm = machine.step else { return XCTFail("previewConfirm bekleniyordu") }
        await machine.create()
        guard case .setup = machine.step else { return XCTFail("setup bekleniyordu") }
        await machine.prepareHandoff()
        guard case .userAssistedImport = machine.step else { return XCTFail("userAssistedImport bekleniyordu") }
        await machine.handOffToShortcuts()
        guard case .waitingForUser = machine.step else { return XCTFail("waitingForUser bekleniyordu") }
        machine.confirmShortcutAdded()
        guard case .linkingTrigger = machine.step else { return XCTFail("linkingTrigger bekleniyordu") }
        await machine.confirmTriggerLinked()

        // The isolated attempt still completes the installation flow.
        guard case .installed(let automation) = machine.step else {
            return XCTFail("installed bekleniyordu")
        }
        XCTAssertEqual(automation.installStatus, .installed)
        let saved = await repository.list()
        XCTAssertEqual(saved.count, 1)
        XCTAssertEqual(saved.first?.installStatus, .installed)
    }

    func testSameAttempt_clarificationAndCorrectionPreserveConversationThroughInstall() async throws {
        let turn1Response = jsonData("""
        {
          "status": "needs_clarification",
          "conversation": {
            "marker": "turn1",
            "currentPlan": {
              "name": "Klimayı/ön ısıtmasını başlatır",
              "trigger": { "type": "ios.bluetooth.disconnected", "device": null, "params": {} },
              "steps": [ { "type": "tesla.climate.start" } ],
              "missing": [ { "id": "vehicle", "kind": "device_or_person", "question": "Hangi aracı kullanalım?", "options": ["Tesla Model Y", "Tesla Model 3"], "optional": false } ],
              "answers": {}
            }
          }
        }
        """)
        let turn2Response = jsonData("""
        {
          "status": "plan",
          "plan": {
            "name": "Klimayı/ön ısıtmasını başlatır",
            "trigger": { "type": "ios.bluetooth.disconnected", "device": "Tesla Model Y", "params": {} },
            "steps": [ { "type": "tesla.climate.start" } ],
            "missing": [],
            "answers": { "vehicle": "Tesla Model Y" }
          },
          "validation": { "stage": "complete", "ok": true, "issues": [] },
          "conversation": { "marker": "turn2" }
        }
        """)
        let turn3Response = jsonData("""
        {
          "status": "plan",
          "plan": {
            "name": "Klimayı/ön ısıtmasını başlatır",
            "trigger": { "type": "ios.bluetooth.disconnected", "device": "Tesla Model 3", "params": {} },
            "steps": [ { "type": "tesla.climate.start" } ],
            "missing": [],
            "answers": { "vehicle": "Tesla Model 3" }
          },
          "validation": { "stage": "complete", "ok": true, "issues": [] },
          "conversation": { "marker": "turn3" }
        }
        """)
        let transport = ScriptedTransport(responses: [
            PlanHTTPResult(statusCode: 200, body: turn1Response),
            PlanHTTPResult(statusCode: 200, body: turn2Response),
            PlanHTTPResult(statusCode: 200, body: turn3Response),
        ])
        let planner = HTTPBackedPlanner(transport: transport, permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]))

        let registry = try CapabilityRegistry.loadFromBundle()
        let repository = InMemoryAutomationRepository()
        let machine = BuilderMachine(
            registry: registry, planner: planner,
            permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]),
            setup: MockSetupService(), shortcutsHandoff: MockShortcutsHandoff(),
            repository: repository, device: DeviceContext(osVersion: 26, hasCarPlay: false)
        )
        await machine.open()
        machine.setText("Arabadan inince klimayı aç.")
        await machine.submit()
        guard case .understanding(let draft1) = machine.step else { return XCTFail("understanding expected") }
        XCTAssertEqual(draft1.missing.first?.id, "vehicle")

        machine.revise()
        machine.setText("Tesla Model Y.")
        await machine.submit()
        guard case .understanding(let draft2) = machine.step else { return XCTFail("understanding expected") }
        XCTAssertEqual(draft2.trigger.device, "Tesla Model Y")
        XCTAssertEqual(draft2.trigger.type, "ios.bluetooth.disconnected")
        XCTAssertEqual(draft2.steps, [.action(type: "tesla.climate.start", params: nil)])

        machine.revise()
        machine.setText("Hayır, Model 3.")
        await machine.submit()
        guard case .understanding(let draft3) = machine.step else { return XCTFail("understanding expected") }
        XCTAssertEqual(draft3.trigger.device, "Tesla Model 3")
        // Tetikleyici ve eylem KORUNUR — yalnızca araç değişti.
        XCTAssertEqual(draft3.trigger.type, "ios.bluetooth.disconnected")
        XCTAssertEqual(draft3.steps, [.action(type: "tesla.climate.start", params: nil)])

        // Bağlam gerçekten TAŞINDI mı? 2. istek, 1. yanıtın `conversation`
        // alanını AYNEN içermeli; 3. istek 2. yanıtınkini.
        let bodies = await transport.receivedBodies
        XCTAssertEqual(bodies.count, 3)
        let sentConversation2 = jsonObject(bodies[1])?["conversation"] as? [String: Any]
        let turn1Conversation = jsonObject(turn1Response)?["conversation"] as? [String: Any]
        XCTAssertEqual(sentConversation2?["marker"] as? String, turn1Conversation?["marker"] as? String)
        XCTAssertEqual(sentConversation2?["marker"] as? String, "turn1")

        let sentConversation3 = jsonObject(bodies[2])?["conversation"] as? [String: Any]
        XCTAssertEqual(sentConversation3?["marker"] as? String, "turn2")

        // İlk istek (turn 1) henüz hiçbir konuşma taşımamalı.
        XCTAssertNil(jsonObject(bodies[0])?["conversation"])
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        await machine.handOffToShortcuts()
        machine.confirmShortcutAdded()
        await machine.confirmTriggerLinked()
        guard case .installed(let automation) = machine.step else { return XCTFail("installed expected") }
        XCTAssertEqual(automation.installStatus, .installed)
        let records = await repository.list()
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(records.first?.installStatus, .installed)
    }
}
