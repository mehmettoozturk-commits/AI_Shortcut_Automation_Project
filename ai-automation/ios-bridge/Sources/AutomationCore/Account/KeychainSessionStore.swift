import Foundation
import Security

/// Bearer credentials never enter account-state.json, UserDefaults, or logs.
public struct SecureAccountSession: Codable, Sendable, Equatable {
    public let appleUserID: String
    public let accountID: String
    public let token: String

    public init(appleUserID: String, accountID: String, token: String) {
        self.appleUserID = appleUserID
        self.accountID = accountID
        self.token = token
    }
}

public protocol SecureSessionStore: Sendable {
    func load() async -> SecureAccountSession?
    func save(_ session: SecureAccountSession) async -> Bool
    func delete() async -> Bool
}

/// One non-synchronizing, this-device-only generic-password item.
public actor KeychainSessionStore: SecureSessionStore, PlanCredentialSource {
    private let service: String
    private let account = "apple-app-session"
    private let copyMatching: @Sendable (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus

    public init(service: String) {
        self.service = service
        self.copyMatching = { query, result in SecItemCopyMatching(query, result) }
    }

    /// Internal syscall seam: tests never read real Keychain items or secrets.
    init(service: String, copyMatching: @escaping @Sendable (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus) {
        self.service = service
        self.copyMatching = copyMatching
    }

    private func query() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kCFBooleanFalse as Any,
        ]
    }

    public func load() async -> SecureAccountSession? {
        try? readSession()
    }

    public func planSession() async throws -> SecureAccountSession? {
        try readSession()
    }

    private func readSession() throws -> SecureAccountSession? {
        var attributes = query()
        attributes[kSecReturnData as String] = kCFBooleanTrue
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = copyMatching(attributes as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess,
              let data = result as? Data,
              let session = try? JSONDecoder().decode(SecureAccountSession.self, from: data),
              !session.appleUserID.isEmpty, !session.accountID.isEmpty, !session.token.isEmpty
        else { throw PlannerError.plannerUnreachable(message: "Hesap oturumu güvenli biçimde okunamadı.") }
        return session
    }

    public func save(_ session: SecureAccountSession) async -> Bool {
        guard !session.appleUserID.isEmpty, !session.accountID.isEmpty, !session.token.isEmpty,
              let data = try? JSONEncoder().encode(session) else { return false }
        let update = [kSecValueData as String: data]
        let status = SecItemUpdate(query() as CFDictionary, update as CFDictionary)
        if status == errSecSuccess { return true }
        guard status == errSecItemNotFound else { return false }
        var attributes = query()
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess
    }

    public func delete() async -> Bool {
        let status = SecItemDelete(query() as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}
