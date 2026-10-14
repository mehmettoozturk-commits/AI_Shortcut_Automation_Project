import Foundation
import XCTest
@testable import AutomationCore

private struct FakeAppleCredentials: AppleCredentialProvider {
    let outcome: AppleCredentialOutcome
    let credentialState: AccountCredentialState
    func request(nonce: String) async -> AppleCredentialOutcome { outcome }
    func state(for appleUserID: String) async -> AccountCredentialState { credentialState }
}

private actor FakeAuthBackend: AccountAuthBackend {
    var exchangeCount = 0
    var revokeCount = 0
    var valid = true
    var validationUnavailable = false
    var canRevoke = true
    let challengeValue = AppleAuthChallenge(id: "challenge-1", nonce: "server-nonce")
    func challenge() async throws -> AppleAuthChallenge { challengeValue }
    func exchange(identityToken: String, challenge: AppleAuthChallenge) async throws -> BackendAccountSession {
        XCTAssertEqual(challenge.nonce, challengeValue.nonce)
        exchangeCount += 1
        return BackendAccountSession(accountID: "backend-account", token: "opaque-session-token")
    }
    func validate(token: String) async throws -> Bool {
        if validationUnavailable { throw AccountBackendError.invalidResponse }
        return valid
    }
    func revoke(token: String) async throws -> Bool {
        revokeCount += 1
        return canRevoke
    }
}

private actor CreationBackend: AccountAuthBackend {
    var createCount = 0
    var failure: AccountBackendError?
    var networkFailure = false
    func fail(with error: AccountBackendError) { failure = error }
    func failNetwork() { networkFailure = true }
    func challenge() async throws -> AppleAuthChallenge { AppleAuthChallenge(id: "login", nonce: "login-nonce") }
    func exchange(identityToken: String, challenge: AppleAuthChallenge) async throws -> BackendAccountSession { throw AccountBackendError.creationRequired("fixture-ticket") }
    func creationChallenge(ticket: String) async throws -> AppleAuthChallenge { AppleAuthChallenge(id: "creation", nonce: "creation-nonce") }
    func createAccount(ticket: String, identityToken: String, challenge: AppleAuthChallenge) async throws -> BackendAccountSession {
        XCTAssertEqual(challenge.id, "creation")
        XCTAssertEqual(challenge.nonce, "creation-nonce")
        XCTAssertEqual(identityToken, "proof-creation-nonce")
        createCount += 1
        if let failure { throw failure }
        if networkFailure { throw URLError(.networkConnectionLost) }
        return BackendAccountSession(accountID: "fixture-account", token: "fixture-session")
    }
    func validate(token: String) async throws -> Bool { true }
    func revoke(token: String) async throws -> Bool { true }
}

private actor NonceCredentials: AppleCredentialProvider {
    var nonces: [String] = []
    func request(nonce: String) async -> AppleCredentialOutcome {
        nonces.append(nonce)
        return .credential(AppleIdentityCredential(appleUserID: "fixture-user", identityToken: "proof-" + nonce))
    }
    func state(for appleUserID: String) async -> AccountCredentialState { .authorized }
}

private actor FakeSecureSessionStore: SecureSessionStore {
    var current: SecureAccountSession?
    var canSave = true
    var saveCount = 0
    func load() async -> SecureAccountSession? { current }
    func save(_ session: SecureAccountSession) async -> Bool {
        saveCount += 1
        if canSave { current = session }
        return canSave
    }
    func delete() async -> Bool { current = nil; return true }
}

final class AppleAccountAuthorizerTests: XCTestCase {
    func testExpiredTicketAndExistingAccountKeepDistinctRecoveryMessages() async {
        for error in [AccountBackendError.creationExpired, .accountExists] {
            let backend = CreationBackend()
            await backend.fail(with: error)
            let sessions = FakeSecureSessionStore()
            let authorizer = AppleAccountAuthorizer(credentials: NonceCredentials(), backend: backend, sessions: sessions)
            let service = AccountService(authorizer: authorizer, store: FileBackedAccountStateStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)))
            _ = await service.linkWithResult()
            let result = await service.createAccountWithResult()
            switch error {
            case .creationExpired: XCTAssertEqual(result, .failedWithMessage("İşlemin süresi doldu. Lütfen yeniden Apple ile giriş yap."))
            case .accountExists: XCTAssertEqual(result, .failedWithMessage("Hesabın mevcut. Apple ile giriş yapabilirsin."))
            default: XCTFail("fixture")
            }
            let retry = await service.createAccountWithResult()
            let creates = await backend.createCount
            let writes = await sessions.saveCount
            XCTAssertEqual(retry, .failed)
            XCTAssertEqual(creates, 1)
            XCTAssertEqual(writes, 0)
        }
    }

    func testNetworkUnknownCreateResultDoesNotRetryOrSave() async {
        let backend = CreationBackend()
        await backend.failNetwork()
        let sessions = FakeSecureSessionStore()
        let authorizer = AppleAccountAuthorizer(credentials: NonceCredentials(), backend: backend, sessions: sessions)
        let result = await authorizer.createAccount(appleUserID: "fixture-user", ticket: "fixture-ticket")
        let creates = await backend.createCount
        let writes = await sessions.saveCount
        XCTAssertEqual(result, .failedWithMessage("İşlem sonucu doğrulanamadı. Lütfen yeniden giriş yap."))
        XCTAssertEqual(creates, 1)
        XCTAssertEqual(writes, 0)
    }

    func testCreationKeychainWriteFailureNeverClaimsLinked() async {
        let backend = CreationBackend()
        let sessions = FakeSecureSessionStore()
        await sessions.setCanSave(false)
        let authorizer = AppleAccountAuthorizer(credentials: NonceCredentials(), backend: backend, sessions: sessions)
        let result = await authorizer.createAccount(appleUserID: "fixture-user", ticket: "fixture-ticket")
        let saved = await sessions.load()
        XCTAssertEqual(result, .failed)
        XCTAssertNil(saved)
    }
    func testMissingAccountDoesNotWriteKeychainAndConfirmationGetsFreshAppleProof() async {
        let backend = CreationBackend()
        let credentials = NonceCredentials()
        let sessions = FakeSecureSessionStore()
        let authorizer = AppleAccountAuthorizer(credentials: credentials, backend: backend, sessions: sessions)
        let first = await authorizer.authorize()
        let beforeWrites = await sessions.saveCount
        let beforeCreates = await backend.createCount
        XCTAssertEqual(first, .creationRequired(appleUserID: "fixture-user", ticket: "fixture-ticket"))
        XCTAssertEqual(beforeWrites, 0)
        XCTAssertEqual(beforeCreates, 0)
        let created = await authorizer.createAccount(appleUserID: "fixture-user", ticket: "fixture-ticket")
        let nonces = await credentials.nonces
        let stored = await sessions.load()
        XCTAssertEqual(created, .authorized(appleUserID: "fixture-user"))
        XCTAssertEqual(nonces, ["login-nonce", "creation-nonce"])
        XCTAssertEqual(stored?.token, "fixture-session")
    }

    func testFreshAppleCancellationCannotCallCreateOrSave() async {
        let backend = CreationBackend()
        let sessions = FakeSecureSessionStore()
        let authorizer = AppleAccountAuthorizer(credentials: FakeAppleCredentials(outcome: .cancelled, credentialState: .unknown), backend: backend, sessions: sessions)
        let result = await authorizer.createAccount(appleUserID: "fixture-user", ticket: "fixture-ticket")
        let creates = await backend.createCount
        let writes = await sessions.saveCount
        XCTAssertEqual(result, .failedWithMessage("Hesap oluşturma iptal edildi."))
        XCTAssertEqual(creates, 0)
        XCTAssertEqual(writes, 0)
    }

    func testDifferentFreshAppleUserCannotCallCreate() async {
        let backend = CreationBackend()
        let sessions = FakeSecureSessionStore()
        let authorizer = AppleAccountAuthorizer(credentials: NonceCredentials(), backend: backend, sessions: sessions)
        _ = await authorizer.createAccount(appleUserID: "different-user", ticket: "fixture-ticket")
        let creates = await backend.createCount
        let writes = await sessions.saveCount
        XCTAssertEqual(creates, 0)
        XCTAssertEqual(writes, 0)
    }
    func testCancelNeverExchangesOrWritesSession() async {
        let backend = FakeAuthBackend()
        let sessions = FakeSecureSessionStore()
        let authorizer = AppleAccountAuthorizer(
            credentials: FakeAppleCredentials(outcome: .cancelled, credentialState: .unknown),
            backend: backend, sessions: sessions
        )
        let result = await authorizer.authorize()
        let exchangeCount = await backend.exchangeCount
        let saveCount = await sessions.saveCount
        XCTAssertEqual(result, .cancelled)
        XCTAssertEqual(exchangeCount, 0)
        XCTAssertEqual(saveCount, 0)
    }

    func testLinkedOnlyAfterSecureStoreAndRestoreChecksBackend() async {
        let backend = FakeAuthBackend()
        let sessions = FakeSecureSessionStore()
        let credential = AppleIdentityCredential(appleUserID: "apple-user", identityToken: "jwt")
        let authorizer = AppleAccountAuthorizer(
            credentials: FakeAppleCredentials(outcome: .credential(credential), credentialState: .authorized),
            backend: backend, sessions: sessions
        )
        let result = await authorizer.authorize()
        XCTAssertEqual(result, .authorized(appleUserID: "apple-user"))
        let stored = await sessions.load()
        XCTAssertEqual(stored?.accountID, "backend-account")
        XCTAssertEqual(stored?.appleUserID, "apple-user")
        let authorizedState = await authorizer.credentialState(for: "apple-user")
        XCTAssertEqual(authorizedState, .authorized)
        await backend.setValid(false)
        let revokedState = await authorizer.credentialState(for: "apple-user")
        let unlinked = await authorizer.unlink()
        let afterUnlink = await sessions.load()
        XCTAssertEqual(revokedState, .revoked)
        XCTAssertTrue(unlinked)
        XCTAssertNil(afterUnlink)
    }

    func testFailedKeychainWriteCannotLinkAndRevokesIssuedSession() async {
        let backend = FakeAuthBackend()
        let sessions = FakeSecureSessionStore()
        await sessions.setCanSave(false)
        let credential = AppleIdentityCredential(appleUserID: "apple-user", identityToken: "jwt")
        let authorizer = AppleAccountAuthorizer(
            credentials: FakeAppleCredentials(outcome: .credential(credential), credentialState: .authorized),
            backend: backend, sessions: sessions
        )
        let result = await authorizer.authorize()
        let stored = await sessions.load()
        let revokeCount = await backend.revokeCount
        XCTAssertEqual(result, .failed)
        XCTAssertNil(stored)
        XCTAssertEqual(revokeCount, 1)
    }

    func testTransientBackendErrorPreservesKeychainSession() async {
        let backend = FakeAuthBackend()
        let sessions = FakeSecureSessionStore()
        let credential = AppleIdentityCredential(appleUserID: "apple-user", identityToken: "jwt")
        let authorizer = AppleAccountAuthorizer(
            credentials: FakeAppleCredentials(outcome: .credential(credential), credentialState: .authorized),
            backend: backend, sessions: sessions
        )
        _ = await authorizer.authorize()
        await backend.setValidationUnavailable(true)
        let state = await authorizer.credentialState(for: "apple-user")
        let stillStored = await sessions.load()
        XCTAssertEqual(state, .unknown)
        XCTAssertNotNil(stillStored)
    }

    func testAppleRevokedClearsLocalSession() async {
        let backend = FakeAuthBackend()
        let sessions = FakeSecureSessionStore()
        let credential = AppleIdentityCredential(appleUserID: "apple-user", identityToken: "jwt")
        let signIn = AppleAccountAuthorizer(
            credentials: FakeAppleCredentials(outcome: .credential(credential), credentialState: .authorized),
            backend: backend, sessions: sessions
        )
        _ = await signIn.authorize()
        let revoked = AppleAccountAuthorizer(
            credentials: FakeAppleCredentials(outcome: .failed, credentialState: .revoked),
            backend: backend, sessions: sessions
        )
        let state = await revoked.credentialState(for: "apple-user")
        let after = await sessions.load()
        XCTAssertEqual(state, .revoked)
        XCTAssertNil(after)
    }

    func testFailedDurableLinkRollbackClearsKeychainEvenWhenServerRevokeFails() async {
        let backend = FakeAuthBackend()
        let sessions = FakeSecureSessionStore()
        let credential = AppleIdentityCredential(appleUserID: "apple-user", identityToken: "jwt")
        let authorizer = AppleAccountAuthorizer(
            credentials: FakeAppleCredentials(outcome: .credential(credential), credentialState: .authorized),
            backend: backend, sessions: sessions
        )
        _ = await authorizer.authorize()
        await backend.setCanRevoke(false)
        await authorizer.rollbackFailedLink()
        let after = await sessions.load()
        XCTAssertNil(after)
    }
}

private extension FakeAuthBackend {
    func setValid(_ value: Bool) { valid = value }
    func setValidationUnavailable(_ value: Bool) { validationUnavailable = value }
    func setCanRevoke(_ value: Bool) { canRevoke = value }
}

private extension FakeSecureSessionStore {
    func setCanSave(_ value: Bool) { canSave = value }
}
