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
public actor KeychainSessionStore: SecureSessionStore {
    private let service: String
    private let account = "apple-app-session"

    public init(service: String) {
        self.service = service
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
        var attributes = query()
        attributes[kSecReturnData as String] = kCFBooleanTrue
        attributes[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(attributes as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let session = try? JSONDecoder().decode(SecureAccountSession.self, from: data),
              !session.appleUserID.isEmpty, !session.accountID.isEmpty, !session.token.isEmpty
        else { return nil }
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
