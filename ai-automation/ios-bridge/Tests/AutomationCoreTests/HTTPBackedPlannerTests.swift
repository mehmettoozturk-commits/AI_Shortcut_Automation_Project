// Phase 4C — Swift -> Backend -> LLM'in ilk gerçek uçtan uca dikey dilimi.
//
// Hiçbir test gerçek Anthropic/HTTP ağ çağrısı yapmaz (TS tarafındaki
// Phase 4B fake-provider disiplini korunuyor, bkz.
// tests/llm-provider.test.ts) — `FakeTransport`, `PlanHTTPTransport`
// protokolünü sahte, önceden hazırlanmış (statusCode, body) çiftleriyle
// uygular ve gönderilen her istek gövdesini kaydeder.

import XCTest
@testable import AutomationCore

private actor FakeTransport: PlanHTTPTransport {
    private var responses: [PlanHTTPResult]
    private var failure: Error?
    private(set) var receivedBodies: [Data] = []
    private var index = 0

    init(responses: [PlanHTTPResult]) { self.responses = responses }
    init(throwing error: Error) {
        self.responses = []
        self.failure = error
    }

    func send(requestBody: Data) async throws -> PlanHTTPResult {
        receivedBodies.append(requestBody)
        if let failure { throw failure }
        guard index < responses.count else {
            throw URLError(.unknown)
        }
        defer { index += 1 }
        return responses[index]
    }
}

private func jsonData(_ string: String) -> Data { Data(string.utf8) }

private func jsonObject(_ data: Data) -> [String: Any]? {
    (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
}

@MainActor
final class HTTPBackedPlannerTests: XCTestCase {
    func makeRegistry() throws -> CapabilityRegistry {
        try CapabilityRegistry.loadFromBundle()
    }

    // MARK: - Test A — basit plan
    // "Pil yüzde 20'ye düşünce bana haber ver" -> tek turda tam bir plan.
    // EN ÖNEMLİ TEST (kullanıcının kendi ifadesiyle): draft.steps'teki
    // capability id'nin HTTPBackedPlanner'ın KENDİ kodundan değil,
    // backend'in JSON yanıtından geldiğini kanıtlar — bu dosya o id'yi
    // hiç bilmez/üretmez, yalnızca TAŞIR (bkz. testNoCapabilityIdHardcoded).
    func testA_simplePlan() async throws {
        let response = jsonData("""
        {
          "status": "plan",
          "plan": {
            "name": "Bildirim gönderir",
            "trigger": { "type": "ios.battery.falls_below", "device": null, "params": { "level": 20, "condition": "below" } },
            "steps": [ { "type": "ios.notification.show" } ],
            "missing": [],
            "answers": {}
          },
          "validation": { "stage": "complete", "ok": true, "issues": [] },
          "conversation": { "marker": "turnA" }
        }
        """)
        let transport = FakeTransport(responses: [PlanHTTPResult(statusCode: 200, body: response)])
        let planner = HTTPBackedPlanner(transport: transport, permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]))

        let result = await planner.plan(text: "Pil yüzde 20'ye düşünce bana haber ver", existingDraft: nil)
        guard case .plan(let draft) = result else { return XCTFail("plan bekleniyordu") }

        XCTAssertEqual(draft.trigger.type, "ios.battery.falls_below")
        // Bu string HTTPBackedPlanner.swift kaynak kodunda HİÇBİR YERDE
        // geçmez (bkz. testNoCapabilityIdHardcoded) — yalnızca bu JSON
        // yanıtından geldi.
        XCTAssertEqual(draft.steps, [.action(type: "ios.notification.show", params: nil)])
        let lastError = await planner.lastError
        XCTAssertNil(lastError)
    }

    // MARK: - Test B — clarification (AM/PM belirsizliği)
    // Backend `needs_clarification` döndüğünde, `conversation.currentPlan`
    // (backend'in ZATEN çözdüğü tam taslak, `missing` dahil) `.plan(...)`
    // olarak Swift'e aktarılır — TS `NluPlannerAdapter`'ın aynı deseni.
    func testB_clarificationExposesPendingQuestionViaCurrentPlan() async throws {
        let response = jsonData("""
        {
          "status": "needs_clarification",
          "question": { "id": "time_of_day", "kind": "trigger", "question": "Sabah 9 mu, akşam 9 mu?", "options": ["Sabah", "Akşam"], "optional": false },
          "conversation": {
            "lastMissingField": "time_of_day",
            "currentPlan": {
              "name": "Bildirim gönderir",
              "trigger": { "type": "time", "device": null, "params": {} },
              "steps": [ { "type": "ios.notification.show" } ],
              "missing": [ { "id": "time_of_day", "kind": "trigger", "question": "Sabah 9 mu, akşam 9 mu?", "options": ["Sabah", "Akşam"], "optional": false } ],
              "answers": {}
            }
          }
        }
        """)
        let transport = FakeTransport(responses: [PlanHTTPResult(statusCode: 200, body: response)])
        let planner = HTTPBackedPlanner(transport: transport, permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]))

        let result = await planner.plan(text: "9'da hatırlat.", existingDraft: nil)
        guard case .plan(let draft) = result else { return XCTFail("plan (eksik bilgili taslak) bekleniyordu") }
        XCTAssertEqual(draft.missing.first?.id, "time_of_day")
        XCTAssertEqual(draft.missing.first?.options, ["Sabah", "Akşam"])
    }

    // MARK: - Test C — çok turlu düzeltme: yalnızca araç değişmeli
    // En kritik doğrulama: HTTPBackedPlanner her turda YALNIZCA son
    // cümleyi değil, bir önceki yanıttan aldığı `conversation`'ı AYNEN
    // geri göndermeli (backend durumsuz — bkz. docs/api.md §2).
    func testC_multiTurnCorrection_onlyVehicleChangesAndConversationIsThreaded() async throws {
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
        let transport = FakeTransport(responses: [
            PlanHTTPResult(statusCode: 200, body: turn1Response),
            PlanHTTPResult(statusCode: 200, body: turn2Response),
            PlanHTTPResult(statusCode: 200, body: turn3Response),
        ])
        let planner = HTTPBackedPlanner(transport: transport, permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]))

        let first = await planner.plan(text: "Arabadan inince klimayı aç.", existingDraft: nil)
        guard case .plan(let draft1) = first else { return XCTFail("plan bekleniyordu (turn 1)") }
        XCTAssertEqual(draft1.missing.first?.id, "vehicle")

        let second = await planner.plan(text: "Tesla Model Y.", existingDraft: draft1)
        guard case .plan(let draft2) = second else { return XCTFail("plan bekleniyordu (turn 2)") }
        XCTAssertEqual(draft2.trigger.device, "Tesla Model Y")
        XCTAssertEqual(draft2.trigger.type, "ios.bluetooth.disconnected")
        XCTAssertEqual(draft2.steps, [.action(type: "tesla.climate.start", params: nil)])

        let third = await planner.plan(text: "Hayır, Model 3.", existingDraft: draft2)
        guard case .plan(let draft3) = third else { return XCTFail("plan bekleniyordu (turn 3)") }
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
    }

    // MARK: - Test D — unsupported: Swift bunu doğru göstermeli
    // Backend'in ÇÖZDÜĞÜ capability id (`tesla.camera_action`) ve
    // tetikleyici (`ios.bluetooth.disconnected`) sahte bir taslağa gömülür;
    // BuilderMachine'in KENDİ registry kontrolü (Mocks.swift/MockPlanner
    // akışlarında zaten test edilen, değişmeyen mekanizma) bunu doğru
    // `.unsupported` adımına çevirir — HTTPBackedPlanner bu id'nin ANLAMINI
    // hiç yorumlamaz.
    func testD_unsupportedFlowsThroughBuilderMachineAsUnsupportedStep() async throws {
        let response = jsonData("""
        {
          "status": "unsupported",
          "capability": "tesla.camera_action",
          "alternatives": [],
          "reason": "Tesla'nın canlı kamera görüntüleme özelliği iPhone Shortcuts entegrasyonunda bulunmuyor.",
          "trigger": "ios.bluetooth.disconnected",
          "conversation": { "marker": "turnD" }
        }
        """)
        let transport = FakeTransport(responses: [PlanHTTPResult(statusCode: 200, body: response)])
        let planner = HTTPBackedPlanner(transport: transport, permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]))
        let registry = try makeRegistry()

        let machine = BuilderMachine(
            registry: registry,
            planner: planner,
            permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]),
            setup: MockSetupService(),
            shortcutsHandoff: MockShortcutsHandoff(),
            repository: InMemoryAutomationRepository(),
            device: DeviceContext(osVersion: 26, hasCarPlay: false)
        )

        machine.open()
        machine.setText("Arabadan inince Tesla canlı kamerayı aç")
        await machine.submit()

        guard case .unsupported(_, let message, let alternatives, _) = machine.step else {
            return XCTFail("unsupported bekleniyordu, gelen: \(machine.step)")
        }
        XCTAssertTrue(message.contains("Shortcuts"))
        // Alternatifler Swift'in KENDİ registry'sinden türetildi (backend'in
        // gönderdiği [] listesinden DEĞİL) — architecture: capability
        // kararının sahibi backend, ama BuilderMachine + registry
        // ÇALIŞTIRILABİLİRLİK kararını kendi verisiyle teyit eder.
        XCTAssertFalse(alternatives.contains { $0.id == "tesla.camera_action" })
    }

    // MARK: - Test E — provider error, domain-level state olarak ayrı
    func testE_providerErrorSurfacesAsDistinctDomainStateNotGenericFailure() async throws {
        let response = jsonData("""
        { "status": "provider_error", "message": "LLM isteği başarısız oldu (test).", "conversation": { "marker": "turnE" } }
        """)
        let transport = FakeTransport(responses: [PlanHTTPResult(statusCode: 502, body: response)])
        let planner = HTTPBackedPlanner(transport: transport, permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]))

        let result = await planner.plan(text: "herhangi bir şey", existingDraft: nil)
        XCTAssertEqual(result, .notUnderstood)
        let lastError = await planner.lastError
        XCTAssertEqual(lastError, .providerUnavailable(message: "LLM isteği başarısız oldu (test)."))
    }

    // MARK: - Hata eşlemesi tablosunun geri kalanı (400 / 422 / timeout)

    func test400_invalidRequestIsDistinctFromNotUnderstood() async throws {
        let response = jsonData(#"{ "error": "text alanı eksik." }"#)
        let transport = FakeTransport(responses: [PlanHTTPResult(statusCode: 400, body: response)])
        let planner = HTTPBackedPlanner(transport: transport, permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]))

        let result = await planner.plan(text: "", existingDraft: nil)
        XCTAssertEqual(result, .notUnderstood)
        let lastError = await planner.lastError
        XCTAssertEqual(lastError, .invalidRequest(message: "text alanı eksik."))
    }

    func test422_validationFailedCarriesIssues() async throws {
        let response = jsonData("""
        {
          "status": "plan",
          "plan": {
            "name": "Sentry Mode",
            "trigger": { "type": "ios.bluetooth.disconnected", "device": "Tesla Model Y", "params": {} },
            "steps": [ { "type": "tesla.sentry_mode.toggle" } ],
            "missing": [],
            "answers": {}
          },
          "validation": { "stage": "permission", "ok": false, "issues": [ { "code": "missing_permission", "message": "Bluetooth izni gerekli." } ] },
          "conversation": {}
        }
        """)
        let transport = FakeTransport(responses: [PlanHTTPResult(statusCode: 422, body: response)])
        let planner = HTTPBackedPlanner(transport: transport, permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]))

        let result = await planner.plan(text: "Arabadan inince Sentry Mode'u aç", existingDraft: nil)
        XCTAssertEqual(result, .notUnderstood)
        let lastError = await planner.lastError
        XCTAssertEqual(lastError, .validationFailed(issues: ["Bluetooth izni gerekli."]))
    }

    func testNetworkTimeout_mapsToPlannerUnreachable() async throws {
        let transport = FakeTransport(throwing: URLError(.timedOut))
        let planner = HTTPBackedPlanner(transport: transport, permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]))

        let result = await planner.plan(text: "x", existingDraft: nil)
        XCTAssertEqual(result, .notUnderstood)
        let lastError = await planner.lastError
        guard case .plannerUnreachable = lastError else {
            return XCTFail("plannerUnreachable bekleniyordu, gelen: \(String(describing: lastError))")
        }
    }

    // MARK: - Mimari değişmez: capability id hardcode edilmemiş

    func testNoCapabilityIdHardcoded() throws {
        let registry = try makeRegistry()
        let ids = registry.capabilities.map(\.id)
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // HTTPBackedPlannerTests.swift -> AutomationCoreTests/
            .deletingLastPathComponent() // AutomationCoreTests/ -> Tests/
            .deletingLastPathComponent() // Tests/ -> ios-bridge/
            .appendingPathComponent("Sources/AutomationCore/Platform")
        for file in ["HTTPBackedPlanner.swift", "PlanHTTPTransport.swift", "PlannerError.swift"] {
            let source = try String(contentsOf: root.appendingPathComponent(file), encoding: .utf8)
            let hits = ids.filter { source.contains($0) }
            XCTAssertEqual(hits, [], "\(file) içinde hardcode capability id bulundu")
        }
    }
}
