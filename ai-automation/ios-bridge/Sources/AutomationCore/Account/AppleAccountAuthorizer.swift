import Foundation

public struct AppleAuthChallenge: Sendable {
    public let id: String
    public let nonce: String

    public init(id: String, nonce: String) {
        self.id = id
        self.nonce = nonce
    }
}

public struct AppleIdentityCredential: Sendable {
    public let appleUserID: String
    public let identityToken: String

    public init(appleUserID: String, identityToken: String) {
        self.appleUserID = appleUserID
        self.identityToken = identityToken
    }
}

public enum AppleCredentialOutcome: Sendable {
    case credential(AppleIdentityCredential)
    case cancelled
    case failed
}

public protocol AppleCredentialProvider: Sendable {
    func request(nonce: String) async -> AppleCredentialOutcome
    func state(for appleUserID: String) async -> AccountCredentialState
}

public struct BackendAccountSession: Sendable {
    public let accountID: String
    public let token: String

    public init(accountID: String, token: String) {
        self.accountID = accountID
        self.token = token
    }
}

public protocol AccountAuthBackend: Sendable {
    func creationChallenge(ticket: String) async throws -> AppleAuthChallenge
    func createAccount(ticket: String, identityToken: String, challenge: AppleAuthChallenge) async throws -> BackendAccountSession
    func challenge() async throws -> AppleAuthChallenge
    func exchange(identityToken: String, challenge: AppleAuthChallenge) async throws -> BackendAccountSession
    func validate(token: String) async throws -> Bool
    func revoke(token: String) async throws -> Bool
}

public extension AccountAuthBackend {
    func creationChallenge(ticket: String) async throws -> AppleAuthChallenge { throw AccountBackendError.rejected }
    func createAccount(ticket: String, identityToken: String, challenge: AppleAuthChallenge) async throws -> BackendAccountSession { throw AccountBackendError.rejected }
}

/// An Apple sheet is not a linked account. Only backend verification plus a
/// successful Keychain write can authorize the persistent account state.
public struct AppleAccountAuthorizer: AccountAuthorizer {
    private let credentials: AppleCredentialProvider
    private let backend: AccountAuthBackend
    private let sessions: SecureSessionStore

    public init(credentials: AppleCredentialProvider, backend: AccountAuthBackend, sessions: SecureSessionStore) {
        self.credentials = credentials
        self.backend = backend
        self.sessions = sessions
    }

    public func authorize() async -> AccountAuthorization {
        do {
            let challenge = try await backend.challenge()
            guard !challenge.id.isEmpty, !challenge.nonce.isEmpty else { return .failed }
            switch await credentials.request(nonce: challenge.nonce) {
            case .cancelled:
                return .cancelled
            case .failed:
                return .failed
            case .credential(let credential):
                guard !credential.appleUserID.isEmpty, !credential.identityToken.isEmpty else { return .failed }
                let issued: BackendAccountSession
                do { issued = try await backend.exchange(identityToken: credential.identityToken, challenge: challenge) }
                catch AccountBackendError.creationRequired(let ticket) {
                    return .creationRequired(appleUserID: credential.appleUserID, ticket: ticket)
                }
                guard !issued.accountID.isEmpty, !issued.token.isEmpty else { return .failed }
                let session = SecureAccountSession(
                    appleUserID: credential.appleUserID,
                    accountID: issued.accountID,
                    token: issued.token
                )
                guard await sessions.save(session) else {
                    _ = try? await backend.revoke(token: issued.token)
                    return .failed
                }
                return .authorized(appleUserID: credential.appleUserID)
            }
        } catch AccountBackendError.updateRequired {
            return .failedWithMessage("Devam etmek için uygulamayı güncelleyin.")
        } catch is URLError {
            return .failedWithMessage("Sunucuya bağlanılamadı. Lütfen yeniden giriş yap.")
        } catch {
            return .failed
        }
    }

    public func createAccount(appleUserID: String, ticket: String) async -> AccountAuthorization {
        do {
            guard !appleUserID.isEmpty, !ticket.isEmpty else { return .failed }
            let challenge = try await backend.creationChallenge(ticket: ticket)
            guard !challenge.id.isEmpty, !challenge.nonce.isEmpty else { return .failed }
            switch await credentials.request(nonce: challenge.nonce) {
            case .cancelled: return .failedWithMessage("Hesap oluşturma iptal edildi.")
            case .failed: return .failed
            case .credential(let credential):
                guard credential.appleUserID == appleUserID, !credential.identityToken.isEmpty else { return .failedWithMessage("Apple hesabı eşleşmedi. Lütfen yeniden giriş yap.") }
                let issued = try await backend.createAccount(ticket: ticket, identityToken: credential.identityToken, challenge: challenge)
                guard !issued.accountID.isEmpty, !issued.token.isEmpty,
                      await sessions.save(SecureAccountSession(appleUserID: appleUserID, accountID: issued.accountID, token: issued.token)) else {
                    _ = try? await backend.revoke(token: issued.token)
                    return .failed
                }
                return .authorized(appleUserID: appleUserID)
            }
        } catch AccountBackendError.creationExpired {
            return .failedWithMessage("İşlemin süresi doldu. Lütfen yeniden Apple ile giriş yap.")
        } catch AccountBackendError.accountExists {
            return .failedWithMessage("Hesabın mevcut. Apple ile giriş yapabilirsin.")
        } catch is URLError {
            return .failedWithMessage("İşlem sonucu doğrulanamadı. Lütfen yeniden giriş yap.")
        } catch {
            return .failedWithMessage("İşlem tamamlanamadı. Lütfen yeniden giriş yap.")
        }
    }

    public func credentialState(for appleUserID: String) async -> AccountCredentialState {
        guard let session = await sessions.load(), session.appleUserID == appleUserID else { return .revoked }
        let state = await credentials.state(for: appleUserID)
        if state == .revoked {
            _ = try? await backend.revoke(token: session.token)
            _ = await sessions.delete()
            return .revoked
        }
        guard state == .authorized else { return state }
        do {
            if try await backend.validate(token: session.token) { return .authorized }
            _ = await sessions.delete()
            return .revoked
        } catch {
            return .unknown
        }
    }

    public func unlink() async -> Bool {
        guard let session = await sessions.load() else { return true }
        do {
            guard try await backend.revoke(token: session.token) else { return false }
            return await sessions.delete()
        } catch {
            return false
        }
    }

    public func rollbackFailedLink() async {
        guard let session = await sessions.load() else { return }
        _ = try? await backend.revoke(token: session.token)
        _ = await sessions.delete()
    }
}
