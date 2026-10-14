import Foundation

/// Authentication is separate from the ownership of local Shortcuts drafts.
/// Linking an account does not migrate, rename, or rewrite local automations.
public enum AccountState: Codable, Sendable, Equatable {
    case guest
    case linked(appleUserID: String)
    case expired(appleUserID: String)
    case validationUnavailable(appleUserID: String)
    case migrationRequired(appleUserID: String)

    public static let localAutomationOwnerID = "local"
}

public enum AccountAuthorization: Sendable, Equatable {
    case creationRequired(appleUserID: String, ticket: String)
    case failedWithMessage(String)
    case authorized(appleUserID: String)
    case cancelled
    case failed
}

public enum AccountLinkResult: Sendable, Equatable {
    case creationRequired
    case failedWithMessage(String)
    case linked
    case cancelled
    case failed
}

public enum AccountCredentialState: Sendable, Equatable {
    case authorized
    case revoked
    case transferred
    case unknown
}

public protocol AccountAuthorizer: Sendable {
    func createAccount(appleUserID: String, ticket: String) async -> AccountAuthorization
    func authorize() async -> AccountAuthorization
    func credentialState(for appleUserID: String) async -> AccountCredentialState
    func unlink() async -> Bool
    func rollbackFailedLink() async
}

public extension AccountAuthorizer {
    func createAccount(appleUserID: String, ticket: String) async -> AccountAuthorization { .failed }
    func unlink() async -> Bool { false }
    func rollbackFailedLink() async {}
}

public protocol AccountStateStore: Sendable {
    func load() async -> AccountState
    func save(_ state: AccountState) async -> Bool
}

/// P0-2A: no Apple capability is configured yet. Production cannot report
/// a linked account until a real authorizer and backend session are installed.
public struct UnavailableAccountAuthorizer: AccountAuthorizer {
    public init() {}
    public func authorize() async -> AccountAuthorization { .failed }
    public func credentialState(for appleUserID: String) async -> AccountCredentialState { .unknown }
}

public actor AccountService {
    private let authorizer: AccountAuthorizer
    private let store: AccountStateStore
    private var current: AccountState = .guest
    private var pendingCreation: (appleUserID: String, ticket: String)?

    public init(authorizer: AccountAuthorizer, store: AccountStateStore) {
        self.authorizer = authorizer
        self.store = store
    }

    /// Never silently claim a valid session after a credential check fails.
    /// Guest operation remains available regardless of the check result.
    public func restore() async -> AccountState {
        let saved = await store.load()
        switch saved {
        case .guest:
            current = .guest
        case .linked(let id), .expired(let id), .validationUnavailable(let id), .migrationRequired(let id):
            let credential = await authorizer.credentialState(for: id)
            switch credential {
            case .authorized: current = .linked(appleUserID: id)
            case .revoked: current = .expired(appleUserID: id)
            case .transferred: current = .migrationRequired(appleUserID: id)
            case .unknown: current = .validationUnavailable(appleUserID: id)
            }
            if current != saved { _ = await store.save(current) }
        }
        return current
    }

    public func state() -> AccountState { current }

    /// Cancellation and failure have no persistence side effect.
    public func link() async -> AccountState {
        _ = await linkWithResult()
        return current
    }

    public func linkWithResult() async -> AccountLinkResult {
        pendingCreation = nil
        return await apply(await authorizer.authorize())
    }

    public func cancelAccountCreation() { pendingCreation = nil }

    public func createAccountWithResult() async -> AccountLinkResult {
        guard let pending = pendingCreation else { return .failed }
        // A failed or ambiguous create is recovered through fresh login, never automatic retry.
        pendingCreation = nil
        return await apply(await authorizer.createAccount(appleUserID: pending.appleUserID, ticket: pending.ticket))
    }

    private func apply(_ authorization: AccountAuthorization) async -> AccountLinkResult {
        switch authorization {
        case .creationRequired(let id, let ticket):
            guard !id.isEmpty, !ticket.isEmpty else { return .failed }
            pendingCreation = (id, ticket)
            return .creationRequired
        case .failedWithMessage(let message):
            return .failedWithMessage(message)
        case .cancelled:
            return .cancelled
        case .failed:
            return .failed
        case .authorized(let id):
            guard !id.isEmpty else { return .failed }
            guard await store.save(.linked(appleUserID: id)) else {
                await authorizer.rollbackFailedLink()
                return .failed
            }
            current = .linked(appleUserID: id)
            return .linked
        }
    }

    /// Unlink removes only the account association; automation storage is not
    /// injected into this service and therefore cannot be modified here.
    public func unlink() async -> AccountState {
        guard await authorizer.unlink() else { return current }
        guard await store.save(.guest) else {
            switch current {
            case .guest: break
            case .linked(let id), .expired(let id), .validationUnavailable(let id), .migrationRequired(let id):
                current = .expired(appleUserID: id)
                _ = await store.save(current)
            }
            return current
        }
        current = .guest
        return current
    }
}
