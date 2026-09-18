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
        hasCarPlay: Bool = false
    ) -> (BuilderMachine, InMemoryAutomationRepository) {
        let repo = InMemoryAutomationRepository()
        let machine = BuilderMachine(
            registry: registry,
            planner: MockPlanner(registry: registry),
            permissions: MockPermissionService(granted: granted, autoGrant: autoGrant),
            setup: MockSetupService(succeeds: setupSucceeds),
            repository: repo,
            device: DeviceContext(osVersion: 26, hasCarPlay: hasCarPlay)
        )
        return (machine, repo)
    }

    func testOpenTransitionsIdleToCapturing() throws {
        let (machine, _) = try makeMachine(registry: makeRegistry())
        machine.open()
        guard case .capturing(let text, _, let notUnderstood) = machine.step else {
            return XCTFail("capturing bekleniyordu")
        }
        XCTAssertEqual(text, "")
        XCTAssertFalse(notUnderstood)
    }

    func testFullInstallFlow_setupToInstalled() async throws {
        let registry = try makeRegistry()
        let (machine, repo) = makeMachine(registry: registry)

        machine.open()
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

        machine.handOffToShortcuts()
        guard case .waitingForUser = machine.step else { return XCTFail("waitingForUser bekleniyordu") }
        let beforeConfirm = await repo.list()
        XCTAssertEqual(beforeConfirm.count, 0, "kullanıcı doğrulamadan HİÇBİR ŞEY kaydedilmemeli")

        // "Ekledim" — Phase 3B Test 2: bu HENÜZ installed'a götürmez.
        machine.confirmShortcutAdded()
        guard case .linkingTrigger(_, _, let steps) = machine.step else {
            return XCTFail("linkingTrigger bekleniyordu")
        }
        XCTAssertFalse(steps.isEmpty)
        let beforeTriggerLink = await repo.list()
        XCTAssertEqual(beforeTriggerLink.count, 0, "tetikleyici bağlanmadan HİÇBİR ŞEY kaydedilmemeli")

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
        machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        machine.handOffToShortcuts()

        try await Task.sleep(nanoseconds: 30_000_000)

        guard case .waitingForUser = machine.step else {
            return XCTFail("30ms sonra hâlâ waitingForUser olmalı — otomatik ilerleme YOK")
        }
        let saved = await repo.list()
        XCTAssertEqual(saved.count, 0)
    }

    func testShowSuccessRequiresInstalledFirst() async throws {
        let registry = try makeRegistry()
        let (machine, _) = makeMachine(registry: registry)
        machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        machine.handOffToShortcuts()
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
        machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        machine.handOffToShortcuts()
        machine.confirmShortcutAdded() // "Ekledim"
        guard case .linkingTrigger = machine.step else { return XCTFail("linkingTrigger bekleniyordu") }
        let saved = await repo.list()
        XCTAssertEqual(saved.count, 0)
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
        machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        machine.handOffToShortcuts()
        guard case .waitingForUser = machine.step else { return XCTFail("waitingForUser bekleniyordu") }
        await machine.confirmTriggerLinked() // yanlış state, no-op olmalı
        guard case .waitingForUser = machine.step else {
            return XCTFail("confirmTriggerLinked() yanlış state'den geçiş yapmamalı")
        }
        let saved = await repo.list()
        XCTAssertEqual(saved.count, 0)
    }

    func testLinkingTrigger_noAutomaticProgression() async throws {
        let registry = try makeRegistry()
        let (machine, repo) = makeMachine(registry: registry)
        machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        machine.handOffToShortcuts()
        machine.confirmShortcutAdded()

        try await Task.sleep(nanoseconds: 30_000_000)

        guard case .linkingTrigger = machine.step else {
            return XCTFail("30ms sonra hâlâ linkingTrigger olmalı — otomatik ilerleme YOK")
        }
        let saved = await repo.list()
        XCTAssertEqual(saved.count, 0)
    }

    /// "Bağlayamadım" — Ekleyemedim ile aynı sahte-başarı yasağı.
    func testReportInstallFailed_fromLinkingTrigger() async throws {
        let registry = try makeRegistry()
        let (machine, repo) = makeMachine(registry: registry)
        machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        machine.handOffToShortcuts()
        machine.confirmShortcutAdded()
        machine.reportInstallFailed(reason: "Otomasyon tetikleyicisi bağlanamadı.")
        guard case .setupFailed(_, _, let reason) = machine.step else {
            return XCTFail("setupFailed bekleniyordu")
        }
        XCTAssertEqual(reason, "Otomasyon tetikleyicisi bağlanamadı.")
        let saved = await repo.list()
        XCTAssertEqual(saved.count, 0)
    }

    func testCameraRequestBecomesUnsupportedWithAlternatives() async throws {
        let registry = try makeRegistry()
        let (machine, _) = makeMachine(registry: registry)
        machine.open()
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
        machine.open()
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
        machine.open()
        machine.setText("Arabadan inince Tesla Model Y Sentry Mode'u aç")
        await machine.submit()
        await machine.confirmUnderstanding()
        await machine.create()
        await machine.prepareHandoff()
        guard case .setupFailed = machine.step else {
            return XCTFail("setupFailed bekleniyordu (MASTER_SPEC §18: sahte başarı yasağı)")
        }
        let saved = await repo.list()
        XCTAssertEqual(saved.count, 0)
    }
}
