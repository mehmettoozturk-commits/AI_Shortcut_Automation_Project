import Foundation
import Security

public struct SecureAnonymousCredential: Codable, Sendable, Equatable {
    public let token: String
    public let expiresAt: Date
    public let origin: String
    public init(token: String, expiresAt: Date, origin: String) {
        self.token = token; self.expiresAt = expiresAt; self.origin = origin
    }
    public static func canonicalOrigin(_ url: URL) -> String? {
        guard url.scheme?.lowercased() == "https", let host = url.host, !host.isEmpty,
              url.user == nil, url.password == nil else { return nil }
        return "https://\(host.lowercased()):\(url.port ?? 443)"
    }
    public static func validToken(_ token: String) -> Bool {
        guard token.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
              let data = Data(base64Encoded: token.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + "="), data.count == 32 else { return false }
        return data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") == token
    }
    func hasValidShape() -> Bool {
        guard Self.validToken(token), expiresAt.timeIntervalSince1970.isFinite,
              let url = URL(string: origin), Self.canonicalOrigin(url) == origin else { return false }
        return true
    }
}
public protocol AnonymousCredentialStore: Sendable {
    /// Missing item is nil; corrupt/unavailable storage MUST throw.
    func anonymousCredential() async throws -> SecureAnonymousCredential?
    func saveAnonymousCredential(_ value: SecureAnonymousCredential) async throws
}

public actor KeychainAnonymousCredentialStore: AnonymousCredentialStore {
    private let service: String
    private let read: @Sendable (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus
    private let add: @Sendable (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus
    public init(service: String) {
        self.service = service
        read = { SecItemCopyMatching($0, $1) }; add = { SecItemAdd($0, $1) }
    }
    /// Syscall seams use only synthetic values in tests, never real Keychain items.
    init(service: String,
         read: @escaping @Sendable (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus,
         add: @escaping @Sendable (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus) {
        self.service = service; self.read = read; self.add = add
    }
    private func query() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: "anonymous-plan-credential", kSecAttrSynchronizable as String: kCFBooleanFalse as Any]
    }
    private func unavailable() -> PlannerError { .plannerUnreachable(message: "Anonim kimlik güvenli biçimde saklanamıyor.") }
    public func anonymousCredential() async throws -> SecureAnonymousCredential? {
        try readCredential()
    }
    private func readCredential() throws -> SecureAnonymousCredential? {
        var q = query(); q[kSecReturnData as String] = kCFBooleanTrue; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = read(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let value = try? JSONDecoder().decode(SecureAnonymousCredential.self, from: data), value.hasValidShape() else { throw unavailable() }
        return value
    }
    public func saveAnonymousCredential(_ value: SecureAnonymousCredential) async throws {
        guard value.hasValidShape(), let data = try? JSONEncoder().encode(value) else { throw unavailable() }
        // Enrollment never overwrites/rotates an existing identity. SecItemAdd's
        // duplicate-item failure also closes the cross-process overwrite race.
        if let existing = try readCredential() {
            guard existing == value else { throw unavailable() }; return
        }
        var attributes = query(); attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard add(attributes as CFDictionary, nil) == errSecSuccess else { throw unavailable() }
    }
}

/// The actual HomeView status text uses this same tested, redacted presentation policy.
public enum PlanHTTPStatusMessage {
    public static func localized(_ status: Int) -> String {
        switch status {
        case 401: return "Kimlik doğrulanamadı; işlem başlatılamadı."
        case 409: return "Bu işlem daha önce gönderilmiş veya mevcut işlemle çakışıyor. Otomatik tekrar gönderilmedi."
        case 429: return "Günlük AI kullanım hakkın veya istek sınırı doldu. Yeni bir işlem göndermeden önce bekle."
        case 503: return "AI hizmeti veya güvenli yetkilendirme şu anda kullanılamıyor."
        default: return "Plan sunucusu isteği tamamlayamadı. Biraz sonra yeniden dene."
        }
    }
}
