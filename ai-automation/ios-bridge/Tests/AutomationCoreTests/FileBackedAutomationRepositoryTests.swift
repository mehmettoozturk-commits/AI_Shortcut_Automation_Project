// FileBackedAutomationRepository — Phase 3C-3.
//
// BuilderMachine artık create()'te erken bir kayıt oluşturup akış
// boyunca AYNI id'yi güncelliyor; bu, save()'in gerçek bir UPSERT
// olmasını ve verinin gerçekten diske yazılıp geri okunabilmesini
// (Test 8: "uygulamayı kapat/aç") zorunlu kılıyor.

import XCTest
@testable import AutomationCore

final class FileBackedAutomationRepositoryTests: XCTestCase {
    private func tempFileURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("phase3c3-tests-\(UUID().uuidString)")
            .appendingPathComponent("automations.json")
    }

    private func makeAutomation(id: String = "auto-1", installStatus: InstallStatus) -> Automation {
        Automation(
            id: id,
            userId: "local",
            name: "Test otomasyon",
            platform: .ios,
            status: .active,
            trigger: TriggerDTO(type: "ios.bluetooth.disconnected", device: nil),
            workflow: [],
            version: 1,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0),
            requiresGuidedSetup: false,
            installStatus: installStatus
        )
    }

    func testSaveThenList_roundTrips() async throws {
        let repo = FileBackedAutomationRepository(fileURL: tempFileURL())
        await repo.save(makeAutomation(installStatus: .pendingUser))
        let all = await repo.list()
        XCTAssertEqual(all.count, 1)
        XCTAssertEqual(all.first?.installStatus, .pendingUser)
    }

    func testSameIdTwice_isUpsertNotDuplicate() async throws {
        let repo = FileBackedAutomationRepository(fileURL: tempFileURL())
        await repo.save(makeAutomation(installStatus: .pendingUser))
        await repo.save(makeAutomation(installStatus: .installed))
        let all = await repo.list()
        XCTAssertEqual(all.count, 1, "aynı id çoğalmamalı, güncellenmeli")
        XCTAssertEqual(all.first?.installStatus, .installed)
    }

    /// Test 8: "uygulamayı kapat/aç" — AYNI dosyaya işaret eden YENİ bir
    /// repository örneği, önceki örneğin yazdığı durumu görebilmeli.
    func testRestartSimulation_stateSurvivesNewRepositoryInstance() async throws {
        let fileURL = tempFileURL()

        let beforeRestart = FileBackedAutomationRepository(fileURL: fileURL)
        await beforeRestart.save(makeAutomation(installStatus: .pendingUser))
        await beforeRestart.save(makeAutomation(installStatus: .installed))

        // "Restart": aynı dosyaya işaret eden TAMAMEN YENİ bir örnek —
        // gerçek uygulamada bu, süreç sonlanıp yeniden başlatılmasına
        // karşılık gelir; hiçbir bellek-içi state paylaşılmaz.
        let afterRestart = FileBackedAutomationRepository(fileURL: fileURL)
        let restored = await afterRestart.list()
        XCTAssertEqual(restored.count, 1)
        XCTAssertEqual(restored.first?.installStatus, .installed)
        XCTAssertEqual(restored.first?.id, "auto-1")
    }

    func testPendingOrFailedRecord_isNotSilentlyRestoredAsInstalled() async throws {
        let fileURL = tempFileURL()
        let beforeRestart = FileBackedAutomationRepository(fileURL: fileURL)
        await beforeRestart.save(makeAutomation(installStatus: .failed))

        let afterRestart = FileBackedAutomationRepository(fileURL: fileURL)
        let restored = await afterRestart.list()
        XCTAssertEqual(restored.count, 1)
        XCTAssertEqual(restored.first?.installStatus, .failed, "failed sessizce installed'a dönüşmemeli")
    }

    func testEmptyFile_returnsEmptyList_doesNotCrash() async throws {
        let repo = FileBackedAutomationRepository(fileURL: tempFileURL())
        let all = await repo.list()
        XCTAssertTrue(all.isEmpty)
    }

    func testSetActive_updatesExistingRecordInPlace() async throws {
        let fileURL = tempFileURL()
        let repo = FileBackedAutomationRepository(fileURL: fileURL)
        await repo.save(makeAutomation(installStatus: .installed))
        await repo.setActive("auto-1", active: false)
        let all = await repo.list()
        XCTAssertEqual(all.count, 1)
        XCTAssertEqual(all.first?.status, .paused)
    }
}
