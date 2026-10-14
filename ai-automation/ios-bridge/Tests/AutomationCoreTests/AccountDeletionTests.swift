import Foundation
import XCTest
@testable import AutomationCore

private actor DeletionSessions: SecureSessionStore {
    var value: SecureAccountSession? = SecureAccountSession(appleUserID: "fixture-user", accountID: "fixture-account", token: "fixture-session")
    let canDelete: Bool
    init(canDelete: Bool = true) { self.canDelete = canDelete }
    func load() async -> SecureAccountSession? { value }
    func save(_ session: SecureAccountSession) async -> Bool { value = session; return true }
    func delete() async -> Bool { if canDelete { value = nil }; return canDelete }
}
private actor DeletionState: AccountStateStore {
    var value: AccountState = .linked(appleUserID: "fixture-user")
    let canSave: Bool
    init(canSave: Bool = true) { self.canSave = canSave }
    func load() async -> AccountState { value }
    func save(_ state: AccountState) async -> Bool { if canSave { value = state }; return canSave }
}
private struct DeletionCredentials: AppleCredentialProvider {
    let outcome: AppleCredentialOutcome
    func request(nonce: String) async -> AppleCredentialOutcome {
        XCTAssertEqual(nonce, "deletion-fresh-nonce")
        return outcome
    }
    func state(for appleUserID: String) async -> AccountCredentialState { .authorized }
}
private actor DeletionBackend: AccountAuthBackend {
    var deletions = 0
    var unknown = false
    var challengeRequestID: String?
    var pause = false
    var gate: CheckedContinuation<Void, Never>?
    var entered: CheckedContinuation<Void, Never>?
    func pauseDeletion() { pause = true }
    func waitForDeletion() async { if deletions > 0 { return }; await withCheckedContinuation { entered = $0 } }
    func finishDeletion() { gate?.resume(); gate = nil }
    func setUnknown() { unknown = true }
    func challenge() async throws -> AppleAuthChallenge { throw AccountBackendError.rejected }
    func exchange(identityToken: String, challenge: AppleAuthChallenge) async throws -> BackendAccountSession { throw AccountBackendError.rejected }
    func validate(token: String) async throws -> Bool { true }
    func revoke(token: String) async throws -> Bool { true }
    func deletionChallenge(token: String, requestID: String) async throws -> AppleAuthChallenge {
        XCTAssertEqual(token, "fixture-session")
        XCTAssertNotNil(UUID(uuidString: requestID))
        challengeRequestID = requestID
        return AppleAuthChallenge(id: "deletion-id", nonce: "deletion-fresh-nonce")
    }
    func deleteAccount(token: String, requestID: String, identityToken: String, challenge: AppleAuthChallenge) async throws -> BackendAccountDeletion {
        XCTAssertEqual(requestID, challengeRequestID)
        XCTAssertEqual(challenge.id, "deletion-id")
        XCTAssertEqual(challenge.nonce, "deletion-fresh-nonce")
        XCTAssertEqual(identityToken, "fixture-fresh-proof")
        deletions += 1
        if pause { await withCheckedContinuation { gate = $0; entered?.resume(); entered = nil } }
        if unknown { throw URLError(.networkConnectionLost) }
        return BackendAccountDeletion(appleRevocation: "not_configured")
    }
}
final class AccountDeletionTests: XCTestCase {
    private let credential = AppleCredentialOutcome.credential(AppleIdentityCredential(appleUserID: "fixture-user", identityToken: "fixture-fresh-proof"))
    func testD23AppleCancelNeverCallsDelete() async {
        let backend = DeletionBackend()
        let sessions = DeletionSessions()
        let authorizer = AppleAccountAuthorizer(credentials: DeletionCredentials(outcome: .cancelled), backend: backend, sessions: sessions)
        let result = await authorizer.deleteAccount(appleUserID: "fixture-user")
        let calls = await backend.deletions
        let saved = await sessions.load()
        XCTAssertEqual(result, .cancelled)
        XCTAssertEqual(calls, 0)
        XCTAssertNotNil(saved)
    }
    func testD24DifferentFreshAppleUserNeverCallsDelete() async {
        let backend = DeletionBackend()
        let authorizer = AppleAccountAuthorizer(credentials: DeletionCredentials(outcome: .credential(AppleIdentityCredential(appleUserID: "other", identityToken: "fixture-fresh-proof"))), backend: backend, sessions: DeletionSessions())
        _ = await authorizer.deleteAccount(appleUserID: "fixture-user")
        let calls = await backend.deletions
        XCTAssertEqual(calls, 0)
    }
    func testD25D27ConfirmedDeletionClearsSessionAndPreservesAutomationFile() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("automations.json")
        let original = Data("[{\"id\":\"local-automation\"}]".utf8)
        try original.write(to: file)
        let sessions = DeletionSessions()
        let backend = DeletionBackend()
        let authorizer = AppleAccountAuthorizer(credentials: DeletionCredentials(outcome: credential), backend: backend, sessions: sessions)
        let service = AccountService(authorizer: authorizer, store: DeletionState())
        _ = await service.restore()
        let result = await service.deleteAccountWithResult()
        let state = await service.state()
        let session = await sessions.load()
        XCTAssertEqual(result, .deleted(appleRevocation: "not_configured", credentialsCleared: true))
        XCTAssertEqual(state, .guest)
        XCTAssertNil(session)
        XCTAssertEqual(try Data(contentsOf: file), original)
    }
    func testD26UnknownResultIsNotRetriedAndNeverClaimsLinked() async {
        let backend = DeletionBackend()
        await backend.setUnknown()
        let authorizer = AppleAccountAuthorizer(credentials: DeletionCredentials(outcome: credential), backend: backend, sessions: DeletionSessions())
        let service = AccountService(authorizer: authorizer, store: DeletionState())
        _ = await service.restore()
        let first = await service.deleteAccountWithResult()
        let second = await service.deleteAccountWithResult()
        let state = await service.state()
        let calls = await backend.deletions
        XCTAssertEqual(first, .unknown)
        XCTAssertEqual(second, .failed("Önce hesap durumunu doğrula."))
        XCTAssertEqual(state, .validationUnavailable(appleUserID: "fixture-user"))
        XCTAssertEqual(calls, 1)
    }
    func testFailedKeychainCleanupDoesNotUndoKnownServerDeletion() async {
        let sessions = DeletionSessions(canDelete: false)
        let authorizer = AppleAccountAuthorizer(credentials: DeletionCredentials(outcome: credential), backend: DeletionBackend(), sessions: sessions)
        let service = AccountService(authorizer: authorizer, store: DeletionState())
        _ = await service.restore()
        let result = await service.deleteAccountWithResult()
        let state = await service.state()
        XCTAssertEqual(result, .deleted(appleRevocation: "not_configured", credentialsCleared: false))
        XCTAssertEqual(state, .guest)
    }
    func testGuestHasNoDeletionAuthority() async {
        let backend = DeletionBackend()
        let authorizer = AppleAccountAuthorizer(credentials: DeletionCredentials(outcome: credential), backend: backend, sessions: DeletionSessions())
        let service = AccountService(authorizer: authorizer, store: DeletionState())
        let result = await service.deleteAccountWithResult()
        let calls = await backend.deletions
        XCTAssertEqual(result, .failed("Önce hesap durumunu doğrula."))
        XCTAssertEqual(calls, 0)
    }
    func testConcurrentAccountActionsCannotOverwriteDeletionWithStaleRestore() async {
        let backend = DeletionBackend()
        let authorizer = AppleAccountAuthorizer(credentials: DeletionCredentials(outcome: credential), backend: backend, sessions: DeletionSessions())
        let service = AccountService(authorizer: authorizer, store: DeletionState())
        _ = await service.restore()
        await backend.pauseDeletion()
        let deletion = Task { await service.deleteAccountWithResult() }
        await backend.waitForDeletion()
        let concurrentLink = await service.linkWithResult()
        _ = await service.restore()
        XCTAssertEqual(concurrentLink, .failed)
        await backend.finishDeletion()
        _ = await deletion.value
        let restored = await service.restore()
        XCTAssertEqual(restored, .guest)
    }
    func testAccountStateWriteFailureDoesNotRestoreOldLinkedSession() async {
        let authorizer = AppleAccountAuthorizer(credentials: DeletionCredentials(outcome: credential), backend: DeletionBackend(), sessions: DeletionSessions())
        let service = AccountService(authorizer: authorizer, store: DeletionState(canSave: false))
        _ = await service.restore()
        let result = await service.deleteAccountWithResult()
        let state = await service.state()
        XCTAssertEqual(result, .deleted(appleRevocation: "not_configured", credentialsCleared: false))
        XCTAssertEqual(state, .expired(appleUserID: "fixture-user"))
    }
}
