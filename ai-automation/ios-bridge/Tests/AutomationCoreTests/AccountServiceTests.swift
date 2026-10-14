import Foundation
import XCTest
@testable import AutomationCore

private actor TestAccountStore: AccountStateStore {
    var saved: AccountState
    var saveCount = 0
    let canSave: Bool

    init(_ saved: AccountState = .guest, canSave: Bool = true) {
        self.saved = saved
        self.canSave = canSave
    }
    func load() async -> AccountState { saved }
    func save(_ state: AccountState) async -> Bool {
        saveCount += 1
        if canSave { saved = state }
        return canSave
    }
}

private struct TestAuthorizer: AccountAuthorizer {
    let result: AccountAuthorization
    let credential: AccountCredentialState

    func authorize() async -> AccountAuthorization { result }
    func credentialState(for appleUserID: String) async -> AccountCredentialState { credential }
    func unlink() async -> Bool { true }
}

private actor CreationAuthorizer: AccountAuthorizer {
    var creates = 0
    let outcome: AccountAuthorization
    init(outcome: AccountAuthorization = .authorized(appleUserID: "fixture")) { self.outcome = outcome }
    func authorize() async -> AccountAuthorization { .creationRequired(appleUserID: "fixture", ticket: "fixture-ticket") }
    func credentialState(for appleUserID: String) async -> AccountCredentialState { .authorized }
    func createAccount(appleUserID: String, ticket: String) async -> AccountAuthorization {
        XCTAssertEqual(appleUserID, "fixture")
        XCTAssertEqual(ticket, "fixture-ticket")
        creates += 1
        return outcome
    }
}

final class AccountServiceTests: XCTestCase {
    func testCreationRequiredWaitsForExplicitConfirmation() async {
        let authorizer = CreationAuthorizer()
        let store = TestAccountStore()
        let service = AccountService(authorizer: authorizer, store: store)
        let prepared = await service.linkWithResult()
        let beforeCreates = await authorizer.creates
        let beforeWrites = await store.saveCount
        XCTAssertEqual(prepared, .creationRequired)
        XCTAssertEqual(beforeCreates, 0)
        XCTAssertEqual(beforeWrites, 0)
        let created = await service.createAccountWithResult()
        let state = await service.state()
        XCTAssertEqual(created, .linked)
        XCTAssertEqual(state, .linked(appleUserID: "fixture"))
    }

    func testCancelClearsCreationAuthorityWithoutPersistence() async {
        let authorizer = CreationAuthorizer()
        let store = TestAccountStore()
        let service = AccountService(authorizer: authorizer, store: store)
        _ = await service.linkWithResult()
        await service.cancelAccountCreation()
        let result = await service.createAccountWithResult()
        let creates = await authorizer.creates
        let writes = await store.saveCount
        XCTAssertEqual(result, .failed)
        XCTAssertEqual(creates, 0)
        XCTAssertEqual(writes, 0)
    }

    func testAmbiguousCreationIsNotAutomaticallyRetried() async {
        let authorizer = CreationAuthorizer(outcome: .failedWithMessage("Sonuç doğrulanamadı"))
        let store = TestAccountStore()
        let service = AccountService(authorizer: authorizer, store: store)
        _ = await service.linkWithResult()
        let first = await service.createAccountWithResult()
        let second = await service.createAccountWithResult()
        let creates = await authorizer.creates
        let writes = await store.saveCount
        XCTAssertEqual(first, .failedWithMessage("Sonuç doğrulanamadı"))
        XCTAssertEqual(second, .failed)
        XCTAssertEqual(creates, 1)
        XCTAssertEqual(writes, 0)
    }

    func testRestartDoesNotRestorePendingCreationTicket() async {
        let authorizer = CreationAuthorizer()
        let store = TestAccountStore()
        let first = AccountService(authorizer: authorizer, store: store)
        _ = await first.linkWithResult()
        let restarted = AccountService(authorizer: authorizer, store: store)
        let restored = await restarted.restore()
        let result = await restarted.createAccountWithResult()
        let creates = await authorizer.creates
        XCTAssertEqual(restored, .guest)
        XCTAssertEqual(result, .failed)
        XCTAssertEqual(creates, 0)
    }
    func testGuestIsDefaultAndCancelOrFailureDoesNotPersist() async {
        for result: AccountAuthorization in [.cancelled, .failed] {
            let store = TestAccountStore()
            let service = AccountService(
                authorizer: TestAuthorizer(result: result, credential: .authorized),
                store: store
            )
            let restored = await service.restore()
            let linked = await service.link()
            let saveCount = await store.saveCount
            XCTAssertEqual(restored, .guest)
            XCTAssertEqual(linked, .guest)
            XCTAssertEqual(saveCount, 0)
        }
    }

    func testFakeLinkRelaunchAndUnlinkPreserveLocalAutomationFile() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let automationURL = directory.appendingPathComponent("automations.json")
        let baseline = Data("[{\"id\":\"auto-existing\",\"installStatus\":\"pending_user\"}]".utf8)
        try baseline.write(to: automationURL)

        let store = FileBackedAccountStateStore(directory: directory)
        let authorizer = TestAuthorizer(result: .authorized(appleUserID: "opaque-apple-id"), credential: .authorized)
        let first = AccountService(authorizer: authorizer, store: store)
        let initial = await first.restore()
        let linked = await first.link()
        XCTAssertEqual(initial, .guest)
        XCTAssertEqual(linked, .linked(appleUserID: "opaque-apple-id"))
        XCTAssertEqual(try Data(contentsOf: automationURL), baseline)

        let relaunched = AccountService(authorizer: authorizer, store: FileBackedAccountStateStore(directory: directory))
        let restored = await relaunched.restore()
        let unlinked = await relaunched.unlink()
        XCTAssertEqual(restored, .linked(appleUserID: "opaque-apple-id"))
        XCTAssertEqual(unlinked, .guest)
        XCTAssertEqual(try Data(contentsOf: automationURL), baseline)
        let afterLogout = AccountService(authorizer: authorizer, store: FileBackedAccountStateStore(directory: directory))
        let afterLogoutState = await afterLogout.restore()
        XCTAssertEqual(afterLogoutState, .guest)
    }

    func testRevokedOrUnknownCredentialNeverRestoresLinkedState() async {
        for credential: AccountCredentialState in [.revoked, .unknown, .transferred] {
            let store = TestAccountStore(.linked(appleUserID: "opaque-apple-id"))
            let service = AccountService(
                authorizer: TestAuthorizer(result: .failed, credential: credential),
                store: store
            )
            let restored = await service.restore()
            let saved = await store.saved
            let expected: AccountState
            switch credential {
            case .revoked: expected = .expired(appleUserID: "opaque-apple-id")
            case .unknown: expected = .validationUnavailable(appleUserID: "opaque-apple-id")
            case .transferred: expected = .migrationRequired(appleUserID: "opaque-apple-id")
            case .authorized: expected = .linked(appleUserID: "opaque-apple-id")
            }
            XCTAssertEqual(restored, expected)
            XCTAssertEqual(saved, expected)
        }
    }

    func testFailedDurableStateWriteDoesNotClaimLinked() async {
        let store = TestAccountStore(canSave: false)
        let service = AccountService(
            authorizer: TestAuthorizer(result: .authorized(appleUserID: "apple-user"), credential: .authorized),
            store: store
        )
        let result = await service.linkWithResult()
        let state = await service.state()
        let persisted = await store.saved
        XCTAssertEqual(result, .failed)
        XCTAssertEqual(state, .guest)
        XCTAssertEqual(persisted, .guest)
    }
}
