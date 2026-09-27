// Phase 5B P0 — Conversation Isolation Doğrulama Testleri.
//
// Öncesi: Test 5B-3'te terk edilen denemenin conversation'ının yeni denemeye
// sızdığı ampirik ve deterministik olarak kanıtlanmıştı (leakage).
//
// Sonrası (P0 FIX): `Planner` protokolüne `resetConversation()` eklendi.
// `BuilderMachine.open()` ve `BuilderMachine.close()` bu metodu çağırarak
// her yeni denemeyi temiz bir conversation ile başlatır.
//
// Bu test dosyası şunları doğrular:
//   1. Test A: open() ve close() çağrıldığında conversation'ın sıfırlandığı
//      (SpyPlanner ile çağrı sayısı ve fresh attempt invariant'ı).
//   2. Test A2 (End-to-End Leakage Önleme): Terk edilen Attempt 1'in
//      conversation'ı Attempt 2'ye SIZMAZ (`sentConversation2 == nil`).
//   3. Test B (Multi-turn Korunumu): Aynı attempt içindeki ara adımlar
//      conversation'ı SIFIRLAMAZ (intra-attempt multi-turn çalışmaya devam eder).

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

private final class SpyPlanner: Planner, @unchecked Sendable {
    private let lock = NSLock()
    private var _resetCount = 0
    let inner: Planner

    init(inner: Planner = MockPlanner(registry: try! CapabilityRegistry.loadFromBundle())) {
        self.inner = inner
    }

    var resetCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return _resetCount
    }

    func plan(text: String, existingDraft: DraftAutomationPlan?) async -> PlannerResult {
        await inner.plan(text: text, existingDraft: existingDraft)
    }

    func resetConversation() {
        lock.lock()
        _resetCount += 1
        lock.unlock()
        inner.resetConversation()
    }
}


@MainActor
final class ConversationLeakageTests: XCTestCase {
    /// Test A — her open() ve close() planner conversation'ını sıfırlar (fresh attempt invariant)
    func testA_openAndCloseResetsPlannerConversation() throws {
        let registry = try CapabilityRegistry.loadFromBundle()
        let spy = SpyPlanner(inner: MockPlanner(registry: registry))
        let permissions = MockPermissionService(granted: ["bluetooth", "tesla_account"])
        let machine = BuilderMachine(
            registry: registry,
            planner: spy,
            permissions: permissions,
            setup: MockSetupService(),
            shortcutsHandoff: MockShortcutsHandoff(),
            repository: InMemoryAutomationRepository(),
            device: DeviceContext(osVersion: 26, hasCarPlay: false)
        )

        machine.open()
        XCTAssertEqual(spy.resetCount, 1, "open() çağrısı resetConversation tetiklemeli")

        machine.close()
        XCTAssertEqual(spy.resetCount, 2, "close() çağrısı resetConversation tetiklemeli")

        machine.open()
        XCTAssertEqual(spy.resetCount, 3, "ikinci open() çağrısı resetConversation tetiklemeli")
    }


    /// TAM zincir: attempt 1 (araç sorusuna kadar gidip TERK edilir,
    /// `close()`) → attempt 2 (TAMAMEN alakasız, farklı bir otomasyon)
    /// → `installed`'a kadar sürülür. Kanıtlanan: (1) attempt 2'nin
    /// backend'e gönderdiği istek, attempt 1'in `conversation`'ını
    /// TAŞIYOR (leak GERÇEK), (2) `BuilderMachine`'in kendisinde bunu
    /// engelleyen/uyaran HİÇBİR mekanizma yok — akış `installed`'a
    /// kadar KESİNTİSİZ ilerliyor.
    func testAbandonedAttempt_leaksConversationIntoUnrelatedNewAttempt_reachesInstalled() async throws {
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
        machine.open()
        machine.setText("Arabadan inince klimayı aç.")
        await machine.submit()
        guard case .understanding = machine.step else { return XCTFail("understanding bekleniyordu") }
        await machine.confirmUnderstanding()
        guard case .missingInfo = machine.step else { return XCTFail("missingInfo (araç sorusu) bekleniyordu") }

        // Kullanıcı cevaplamadan vazgeçti — ✕ ile çıktı.
        machine.close()
        guard case .idle = machine.step else { return XCTFail("idle bekleniyordu") }

        // --- Attempt 2: TAMAMEN alakasız yeni bir otomasyon ---
        machine.open()
        machine.setText("Pil yüzde 20'ye düşünce bana haber ver")
        await machine.submit()

        // DOĞRULAMA (P0 FIX): attempt 2'nin backend'e gönderdiği payload'da
        // conversation alanı nil olmalıdır (Attempt 1'den HİÇBİR ŞEY SIZMAMIŞTIR).
        let bodies = await transport.receivedBodies
        XCTAssertEqual(bodies.count, 2)
        let sentConversation2 = jsonObject(bodies[1])?["conversation"] as? [String: Any]
        XCTAssertNil(
            sentConversation2,
            "FIX BAŞARILI: close()+open() sonrası YENİ deneme, ESKİ denemenin conversation'ını TAŞIMAZ (nil)"
        )

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

        // KANIT 2: hiçbir ara adım leak'i tespit edip durmadı —
        // `installed`'a KESİNTİSİZ ulaşıldı.
        guard case .installed(let automation) = machine.step else {
            return XCTFail("installed bekleniyordu — leak akışı DURDURMUYOR")
        }
        XCTAssertEqual(automation.installStatus, .installed)
        let saved = await repository.list()
        XCTAssertEqual(saved.count, 1)
        XCTAssertEqual(saved.first?.installStatus, .installed)
    }
    /// Test B — Aynı attempt içindeki ara adımlar bağlamı SIFIRLAMAZ (multi-turn retention)
    func testB_intraAttemptMultiTurnContextIsPreserved() async throws {
        let registry = try CapabilityRegistry.loadFromBundle()
        let spy = SpyPlanner(inner: MockPlanner(registry: registry))
        let permissions = MockPermissionService(granted: ["bluetooth", "tesla_account"])
        let machine = BuilderMachine(
            registry: registry,
            planner: spy,
            permissions: permissions,
            setup: MockSetupService(),
            shortcutsHandoff: MockShortcutsHandoff(),
            repository: InMemoryAutomationRepository(),
            device: DeviceContext(osVersion: 26, hasCarPlay: false)
        )

        machine.open() // tek reset burada (attempt başı)
        XCTAssertEqual(spy.resetCount, 1)

        machine.setText("Arabadan inince Sentry Mode'u aç.")
        await machine.submit()
        guard case .understanding = machine.step else { return XCTFail("understanding bekleniyordu") }

        await machine.confirmUnderstanding() // -> missingInfo (araç sorusu)
        guard case .missingInfo = machine.step else { return XCTFail("missingInfo bekleniyordu") }

        // Ara adımlar reset ÇAĞIRMADI — yalnızca open()'daki 1 çağrı sayıldı.
        XCTAssertEqual(spy.resetCount, 1, "Ara adımlar (submit, confirmUnderstanding) reset çağırmamalı")
    }

}
