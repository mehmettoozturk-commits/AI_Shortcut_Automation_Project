// FileBackedAutomationRepository — Phase 3C-3.
//
// BuilderMachine artık create()'te erken bir kayıt oluşturup akış
// boyunca AYNI id'yi güncelliyor; bu, save()'in gerçek bir UPSERT
// olmasını ve verinin gerçekten diske yazılıp geri okunabilmesini
// (Test 8: "uygulamayı kapat/aç") zorunlu kılıyor.

import XCTest
@testable import AutomationCore

final class FileBackedAutomationRepositoryTests: XCTestCase {
    func testCorruptFileRefusesEveryMutationAndPreservesBytesAfterRestart() async throws {
        let url = tempFileURL()
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let bytes = Data("{broken user data".utf8)
        try bytes.write(to: url)
        for _ in 0..<2 {
            let repo = FileBackedAutomationRepository(fileURL: url)
            _ = await repo.list()
            let state = await repo.storageState()
            XCTAssertEqual(state, .corrupt)
            let saved = await repo.save(makeAutomation(installStatus: .pendingUser))
            let paused = await repo.setActive("auto-1", active: false)
            let deleted = await repo.deleteLocalRecord("auto-1")
            XCTAssertFalse(saved)
            XCTAssertFalse(paused)
            XCTAssertFalse(deleted)
            XCTAssertEqual(try Data(contentsOf: url), bytes)
        }
    }

    func testExistingUnreadablePathIsNotAnEmptyWritableRepository() async throws {
        let url = tempFileURL()
        // A directory provides a deterministic read failure even under an
        // elevated test runner; chmod-based fixtures do not.
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        let repo = FileBackedAutomationRepository(fileURL: url)
        let state = await repo.storageState()
        XCTAssertEqual(state, .readError)
        let saved = await repo.save(makeAutomation(installStatus: .pendingUser))
        XCTAssertFalse(saved)
        var directory: ObjCBool = false
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path, isDirectory: &directory))
        XCTAssertTrue(directory.boolValue)
    }

    func testFailedWriteDoesNotPublishCandidateToCache() async throws {
        let parent = tempFileURL().deletingLastPathComponent()
        try FileManager.default.createDirectory(at: parent.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("not a directory".utf8).write(to: parent)
        let repo = FileBackedAutomationRepository(fileURL: parent.appendingPathComponent("automations.json"))
        let saved = await repo.save(makeAutomation(installStatus: .installed))
        XCTAssertFalse(saved)
        let items = await repo.list()
        XCTAssertTrue(items.isEmpty)
        XCTAssertEqual(try Data(contentsOf: parent), Data("not a directory".utf8))
    }

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
        let saved = await repo.setActive("auto-1", active: false)
        XCTAssertTrue(saved)
        let all = await repo.list()
        XCTAssertEqual(all.count, 1)
        XCTAssertEqual(all.first?.status, .paused)
    }

    func testOlderRecordWithoutSetupProgressStillLoads() throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let original = makeAutomation(installStatus: .pendingUser)
        let data = try encoder.encode(original)
        let restored = try JSONDecoder.withISO8601Dates.decode(Automation.self, from: data)
        XCTAssertEqual(restored.id, original.id)
        XCTAssertNil(restored.setupProgress)
        XCTAssertNil(restored.sourceAutomationId)
    }

    func testSetupProgressSurvivesNewRepositoryInstance() async throws {
        let fileURL = tempFileURL()
        var pending = makeAutomation(installStatus: .pendingUser)
        pending.setupProgress = .linkingTrigger
        await FileBackedAutomationRepository(fileURL: fileURL).save(pending)

        let restored = await FileBackedAutomationRepository(fileURL: fileURL).list()
        XCTAssertEqual(restored.count, 1)
        XCTAssertEqual(restored.first?.setupProgress, .linkingTrigger)
        XCTAssertEqual(restored.first?.installStatus, .pendingUser)
    }

    func testLocalPausePreservesInstallAndResumeCheckpoint() async throws {
        let fileURL = tempFileURL()
        let repo = FileBackedAutomationRepository(fileURL: fileURL)
        var pending = makeAutomation(installStatus: .pendingUser)
        pending.setupProgress = .waitingForUser
        await repo.save(pending)
        let paused = await repo.setActive("auto-1", active: false)
        XCTAssertTrue(paused)

        let reloaded = await FileBackedAutomationRepository(fileURL: fileURL).list()
        XCTAssertEqual(reloaded.first?.status, .paused)
        XCTAssertEqual(reloaded.first?.installStatus, .pendingUser)
        XCTAssertEqual(reloaded.first?.setupProgress, .waitingForUser)
    }

    func testDeleteLocalRecordOnlyRemovesSelectedId() async throws {
        let fileURL = tempFileURL()
        let repo = FileBackedAutomationRepository(fileURL: fileURL)
        await repo.save(makeAutomation(id: "auto-1", installStatus: .installed))
        await repo.save(makeAutomation(id: "auto-2", installStatus: .pendingUser))
        let deleted = await repo.deleteLocalRecord("auto-1")
        XCTAssertTrue(deleted)
        let reloaded = await FileBackedAutomationRepository(fileURL: fileURL).list()
        XCTAssertEqual(reloaded.map(\.id), ["auto-2"])
    }
}

private extension JSONDecoder {
    static var withISO8601Dates: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
