// Builder Flow state machine testleri — tests/builder-machine.test.ts
// ve tests/install-model.test.ts'in Swift karşılığı.
//
// ⚠️ BU TESTLER XCODE'DA ÇALIŞTIRILMADI. TS tarafındaki 101 testin
// davranışsal karşılıklarını burada da yazılı tutmak, Phase 3B'nin
// ilk `swift test` çalıştırmasında neyin doğrulanması gerektiğini
// netleştirir.

import XCTest
@testable import AutomationCore

@MainActor
final class BuilderMachineTests: XCTestCase {
    func makeRegistry() throws -> CapabilityRegistry {
        try CapabilityRegistry.loadFromBundle()
    }

    func makeMachine(
        registry: CapabilityRegistry,
        granted: [String] = ["bluetooth", "tesla_account"],
        autoGrant: Bool = true,
        setupSucceeds: Bool = true,
        handoffSucceeds: Bool = true,
        hasCarPlay: Bool = false
    ) -> (BuilderMachine, InMemoryAutomationRepository) {
        let repo = InMemoryAutomationRepository()
        let machine = BuilderMachine(
            registry: registry,
            planner: MockPlanner(registry: registry),
            permissions: MockPermissionService(granted: granted, autoGrant: autoGrant),
            setup: MockSetupService(succeeds: setupSucceeds),
            shortcutsHandoff: MockShortcutsHandoff(succeeds: handoffSucceeds),
            repository: repo,
            device: DeviceContext(osVersion: 26, hasCarPlay: hasCarPlay)
        )
        return (machine, repo)
    }

    func testOpenTransitionsIdleToCapturing() async throws {
        let (machine, _) = try makeMachine(registry: makeRegistry())
        await machine.open()
        guard case .capturing(let text, _, let notUnderstood) = machine.step else {
            return XCTFail("capturing bekleniyordu")
        }
        XCTAssertEqual(text, "")
        XCTAssertFalse(notUnderstood)
    }

    func testFullInstallFlow_setupToInstalled() async throws {
        let registry = try makeRegistry()
        let (machine, repo) = makeMachine(registry: registry)

        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        guard case .understanding = machine.step else { return XCTFail("understanding bekleniyordu") }

        await machine.confirmUnderstanding()
        guard case .previewConfirm = machine.step else { return XCTFail("previewConfirm bekleniyordu") }

        await machine.create()
        guard case .setup(_, let setupKind) = machine.step else { return XCTFail("setup bekleniyordu") }
        guard case .userAssistedImport = setupKind else {
            return XCTFail("setup yöntemi userAssistedImport olmalı (automatic ASLA üretilmez)")
        }

        await machine.prepareHandoff()
        guard case .userAssistedImport = machine.step else { return XCTFail("userAssistedImport bekleniyordu") }

        await machine.handOffToShortcuts()
        guard case .waitingForUser = machine.step else { return XCTFail("waitingForUser bekleniyordu") }
        // Phase 3C-3: create()'te ERKEN bir pending kayıt oluştu; henüz installed DEĞİL.
        let beforeConfirm = await repo.list()
        XCTAssertEqual(beforeConfirm.count, 1, "erken pending_user kaydı olmalı")
        XCTAssertEqual(beforeConfirm.first?.installStatus, .pendingUser)

        // "Ekledim" — Phase 3B Test 2: bu HENÜZ installed'a götürmez.
        machine.confirmShortcutAdded()
        guard case .linkingTrigger(_, _, let steps) = machine.step else {
            return XCTFail("linkingTrigger bekleniyordu")
        }
        XCTAssertFalse(steps.isEmpty)
        let beforeTriggerLink = await repo.list()
        XCTAssertEqual(beforeTriggerLink.count, 1, "hâlâ aynı kayıt, çoğalmadı")
        XCTAssertEqual(beforeTriggerLink.first?.installStatus, .pendingUser)

        // "Bağladım" — installed'a giden TEK yol.
        await machine.confirmTriggerLinked()
        guard case .installed(let automation) = machine.step else { return XCTFail("installed bekleniyordu") }
        XCTAssertEqual(automation.installStatus, .installed)

        let saved = await repo.list()
        XCTAssertEqual(saved.count, 1)
    }

    func testWaitingForUser_noAutomaticProgression() async throws {
        let registry = try makeRegistry()
        let (machine, repo) = makeMachine(registry: registry)
        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        await machine.handOffToShortcuts()

        try await Task.sleep(nanoseconds: 30_000_000)

        guard case .waitingForUser = machine.step else {
            return XCTFail("30ms sonra hâlâ waitingForUser olmalı — otomatik ilerleme YOK")
        }
        let saved = await repo.list()
        XCTAssertEqual(saved.count, 1)
        XCTAssertEqual(saved.first?.installStatus, .pendingUser)
    }

    func testShowSuccessRequiresInstalledFirst() async throws {
        let registry = try makeRegistry()
        let (machine, _) = makeMachine(registry: registry)
        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        await machine.handOffToShortcuts()
        machine.showSuccess() // installed değil, yok sayılmalı
        guard case .waitingForUser = machine.step else {
            return XCTFail("showSuccess() waitingForUser'dan doğrudan atlayabilmemeli")
        }
    }

    /// Phase 3B Test 2 invariant'ı: "Ekledim" tek başına installed'a
    /// GÖTÜRMEZ; "Bağladım" da ayrıca gerekir.
    func testShortcutAddedWithoutTriggerLinked_cannotReachInstalled() async throws {
        let registry = try makeRegistry()
        let (machine, repo) = makeMachine(registry: registry)
        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        await machine.handOffToShortcuts()
        machine.confirmShortcutAdded() // "Ekledim"
        guard case .linkingTrigger = machine.step else { return XCTFail("linkingTrigger bekleniyordu") }
        let saved = await repo.list()
        XCTAssertEqual(saved.count, 1)
        XCTAssertEqual(saved.first?.installStatus, .pendingUser)
        machine.showSuccess() // installed değil, yok sayılmalı
        guard case .linkingTrigger = machine.step else {
            return XCTFail("showSuccess() linkingTrigger'dan doğrudan atlayabilmemeli")
        }
    }

    /// Ters durum: "Bağladım" (confirmTriggerLinked) yanlış state'den
    /// (henüz "Ekledim" denmemişken) çağrılırsa YOK SAYILMALI.
    func testTriggerLinkedWithoutShortcutAdded_isNoOp() async throws {
        let registry = try makeRegistry()
        let (machine, repo) = makeMachine(registry: registry)
        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        await machine.handOffToShortcuts()
        guard case .waitingForUser = machine.step else { return XCTFail("waitingForUser bekleniyordu") }
        await machine.confirmTriggerLinked() // yanlış state, no-op olmalı
        guard case .waitingForUser = machine.step else {
            return XCTFail("confirmTriggerLinked() yanlış state'den geçiş yapmamalı")
        }
        let saved = await repo.list()
        XCTAssertEqual(saved.count, 1)
        XCTAssertEqual(saved.first?.installStatus, .pendingUser)
    }

    func testLinkingTrigger_noAutomaticProgression() async throws {
        let registry = try makeRegistry()
        let (machine, repo) = makeMachine(registry: registry)
        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        await machine.handOffToShortcuts()
        machine.confirmShortcutAdded()

        try await Task.sleep(nanoseconds: 30_000_000)

        guard case .linkingTrigger = machine.step else {
            return XCTFail("30ms sonra hâlâ linkingTrigger olmalı — otomatik ilerleme YOK")
        }
        let saved = await repo.list()
        XCTAssertEqual(saved.count, 1)
        XCTAssertEqual(saved.first?.installStatus, .pendingUser)
    }

    /// "Bağlayamadım" — Ekleyemedim ile aynı sahte-başarı yasağı. Ama
    /// artık sessizce kaybolmuyor: kayıt `.failed` olarak GÜNCELLENİR
    /// (Test 8) — çoğalmadan, AYNI id ile.
    func testReportInstallFailed_fromLinkingTrigger() async throws {
        let registry = try makeRegistry()
        let (machine, repo) = makeMachine(registry: registry)
        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        await machine.handOffToShortcuts()
        machine.confirmShortcutAdded()
        await machine.reportInstallFailed(reason: "Otomasyon tetikleyicisi bağlanamadı.")
        guard case .setupFailed(_, _, let reason) = machine.step else {
            return XCTFail("setupFailed bekleniyordu")
        }
        XCTAssertEqual(reason, "Otomasyon tetikleyicisi bağlanamadı.")
        let saved = await repo.list()
        XCTAssertEqual(saved.count, 1)
        XCTAssertEqual(saved.first?.installStatus, .failed)
    }

    /// `retrySetup()`, `.failed` bir kaydı yeniden `.pendingUser`'a
    /// döndürür (aktif yeniden deneme, kalıcı bir "failed" damgası
    /// değil).
    func testRetrySetup_resetsFailedRecordToPendingUser() async throws {
        let registry = try makeRegistry()
        let (machine, repo) = makeMachine(registry: registry)
        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        await machine.handOffToShortcuts()
        await machine.reportInstallFailed(reason: "Ekleyemedim")
        let afterFail = await repo.list()
        XCTAssertEqual(afterFail.first?.installStatus, .failed)
        await machine.retrySetup()
        guard case .setup = machine.step else { return XCTFail("setup bekleniyordu") }
        let afterRetry = await repo.list()
        XCTAssertEqual(afterRetry.count, 1)
        XCTAssertEqual(afterRetry.first?.installStatus, .pendingUser)
    }

    func testCameraRequestBecomesUnsupportedWithAlternatives() async throws {
        let registry = try makeRegistry()
        let (machine, _) = makeMachine(registry: registry)
        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y kamerayı aç")
        await machine.submit()
        guard case .unsupported(_, _, let alternatives, let manualSteps) = machine.step else {
            return XCTFail("unsupported bekleniyordu")
        }
        XCTAssertTrue(alternatives.contains { $0.id == "tesla.sentry_mode.toggle" })
        XCTAssertFalse(alternatives.contains { $0.id == "tesla.camera_action" })
        XCTAssertNotNil(manualSteps)
    }

    func testTriggerResolutionPrefersCarPlayWhenAvailable() async throws {
        let registry = try makeRegistry()
        let (machine, _) = makeMachine(registry: registry, hasCarPlay: true)
        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        guard case .previewConfirm(let draft, _, _) = machine.step else {
            return XCTFail("previewConfirm bekleniyordu")
        }
        XCTAssertEqual(draft.trigger.type, "ios.carplay.disconnected")
    }

    func testInstallFailureDoesNotFakeSuccess() async throws {
        let registry = try makeRegistry()
        let (machine, repo) = makeMachine(registry: registry, setupSucceeds: false)
        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        guard case .setupFailed = machine.step else {
            return XCTFail("setupFailed bekleniyordu (MASTER_SPEC §18: sahte başarı yasağı)")
        }
        // Phase 3C-3: "template/hazırlık yok" bir içerik eksikliği,
        // kesin bir başarısızlık değil — kayıt pending_user kalır.
        let saved = await repo.list()
        XCTAssertEqual(saved.count, 1)
        XCTAssertEqual(saved.first?.installStatus, .pendingUser)
    }

    // MARK: - Phase 3C-2: gerçek SetupService/ShortcutsHandoff sınırı

    /// `prepareHandoff()` TEK BAŞINA asla `installed`'a götürmemeli —
    /// yalnızca `userAssistedImport`'a hazırlar.
    func testPrepareHandoffNeverReachesInstalled() async throws {
        let registry = try makeRegistry()
        let (machine, repo) = makeMachine(registry: registry)
        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        guard case .userAssistedImport = machine.step else {
            return XCTFail("userAssistedImport bekleniyordu, installed DEĞİL")
        }
        let saved1 = await repo.list()
        XCTAssertEqual(saved1.count, 1)
        XCTAssertEqual(saved1.first?.installStatus, .pendingUser)
    }

    /// `handOffToShortcuts()` (URL açma başarılı olsa bile) asla
    /// `installed`'a götürmemeli — Apple bize sonucu bildirmez (Test 7),
    /// bu yüzden yalnızca `waitingForUser`'a geçebilir.
    func testHandOffToShortcutsNeverReachesInstalled() async throws {
        let registry = try makeRegistry()
        let (machine, repo) = makeMachine(registry: registry, handoffSucceeds: true)
        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        await machine.handOffToShortcuts()
        guard case .waitingForUser = machine.step else {
            return XCTFail("waitingForUser bekleniyordu, installed DEĞİL")
        }
        let saved2 = await repo.list()
        XCTAssertEqual(saved2.count, 1)
        XCTAssertEqual(saved2.first?.installStatus, .pendingUser)
    }

    /// `shortcutsHandoff.open()` `false` dönerse (OS URL'i işleyemedi —
    /// GERÇEKTEN bildiğimiz bir hata, örn. Shortcuts kurulu değil):
    /// bu meşru bir `setupFailed` nedenidir. "Apple'dan cevap gelmedi"
    /// (bilinmeyen durum) İLE KARIŞTIRILMAMALI.
    func testHandOffToShortcutsFailure_whenOSCannotOpenURL() async throws {
        let registry = try makeRegistry()
        let (machine, repo) = makeMachine(registry: registry, handoffSucceeds: false)
        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        await machine.handOffToShortcuts()
        guard case .setupFailed(_, _, let reason) = machine.step else {
            return XCTFail("setupFailed bekleniyordu")
        }
        XCTAssertEqual(reason, "Kestirmeler uygulaması açılamadı.")
        // OS'un URL'i açamaması GERÇEKTEN bilinen bir hata — .failed meşru.
        let saved3 = await repo.list()
        XCTAssertEqual(saved3.count, 1)
        XCTAssertEqual(saved3.first?.installStatus, .failed)
    }

    /// `handOffToShortcuts()`, `prepareHandoff()`'ın çözdüğü GERÇEK URL'i
    /// açar — uydurma/sabit bir URL değil.
    func testHandOffToShortcutsOpensTheResolvedURL() async throws {
        let registry = try makeRegistry()
        let repo = InMemoryAutomationRepository()
        let handoff = MockShortcutsHandoff(succeeds: true)
        let machine = BuilderMachine(
            registry: registry,
            planner: MockPlanner(registry: registry),
            permissions: MockPermissionService(granted: ["bluetooth", "tesla_account"]),
            setup: MockSetupService(succeeds: true),
            shortcutsHandoff: handoff,
            repository: repo,
            device: DeviceContext(osVersion: 26, hasCarPlay: false)
        )
        await machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        await machine.handOffToShortcuts()
        let opened = await handoff.openedURLs
        XCTAssertEqual(opened, [URL(string: "https://example.com/mock-shortcut-template")!])
    }
}

/// `TemplateBackedSetupService` — Phase 3C-2 gerçek implementasyonu.
/// Registry'nin `template` alanını okur; capability id/parametre
/// HARDCODE ETMEZ.
@MainActor
final class TemplateBackedSetupServiceTests: XCTestCase {
    func testNoTemplateAvailable_forRealCapabilitiesToday() async throws {
        // 2026-09-19 itibarıyla registry'deki 15 capability'den 14'ünde
        // (ios.notification.show HARİÇ, bkz.
        // testTemplateAvailable_forNotificationShow) hâlâ gerçek bir
        // template yok (içerik boşluğu, bkz. TemplateBackedSetupService.
        // swift'in dosya başı yorumu). Bu test o dürüst davranışı
        // kilitler: template yoksa sahte bir "hazır" durumu ASLA
        // üretilmemeli — burada `tesla.sentry_mode.toggle` ile.
        let registry = try CapabilityRegistry.loadFromBundle()
        let service = TemplateBackedSetupService(registry: registry)
        let draft = DraftAutomationPlan(
            name: "Test",
            trigger: TriggerDTO(type: "ios.bluetooth.disconnected", device: "Tesla Model Y"),
            steps: [.action(type: "tesla.sentry_mode.toggle", params: ["mode": AnyCodable("enable")])]
        )
        let result = await service.prepare(draft)
        guard case .noTemplateAvailable = result else {
            return XCTFail("Gerçek bir template olmadığı için .noTemplateAvailable bekleniyordu, ready DEĞİL")
        }
    }

    /// Phase 5A İş 0.5 (2026-09-19) — gerçek, Apple/iCloud tarafından
    /// imzalanmış TEK şablon (`ios.notification.show`, bkz.
    /// docs/phase5a-e2e-validation-plan.md). Capability id/parametre
    /// HARDCODE EDİLMİYOR — sonuç registry'nin kendi `template` alanından
    /// GERÇEKTEN okunuyor mu diye doğrulanıyor.
    func testTemplateAvailable_forNotificationShow() async throws {
        let registry = try CapabilityRegistry.loadFromBundle()
        let service = TemplateBackedSetupService(registry: registry)
        let cap = try XCTUnwrap(registry.find("ios.notification.show"))
        let draft = DraftAutomationPlan(
            name: "Test",
            trigger: TriggerDTO(type: "ios.bluetooth.disconnected", device: nil),
            steps: [.action(type: "ios.notification.show", params: nil)]
        )
        let result = await service.prepare(draft)
        guard case .ready(let url, let suggestedName) = result else {
            return XCTFail("Gerçek bir template var, .ready bekleniyordu")
        }
        XCTAssertEqual(url.absoluteString, cap.template?.iCloudURL)
        XCTAssertEqual(suggestedName, cap.template?.suggestedName)
        XCTAssertEqual(url.host, "www.icloud.com")
    }

    func testUnknownCapability_isNoTemplateAvailable_notCrash() async throws {
        let registry = try CapabilityRegistry.loadFromBundle()
        let service = TemplateBackedSetupService(registry: registry)
        let draft = DraftAutomationPlan(
            name: "Test",
            trigger: TriggerDTO(type: "ios.bluetooth.disconnected", device: nil),
            steps: [.action(type: "made.up.capability", params: nil)]
        )
        let result = await service.prepare(draft)
        guard case .noTemplateAvailable = result else {
            return XCTFail(".noTemplateAvailable bekleniyordu")
        }
    }
}
