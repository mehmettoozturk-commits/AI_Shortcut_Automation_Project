// Phase 4C — `POST /plan`'a giden ham HTTP taşıma katmanı.
//
// `HTTPBackedPlanner`, bir `URLSession` yerine bu PROTOKOLE bağımlıdır
// ki XCTest'te gerçek bir ağ çağrısı YAPILMADAN (bkz. Phase 4B'nin
// `ClaudeMessagesClient` enjeksiyonu ile aynı desen — TS tarafındaki
// fake-provider yaklaşımının Swift karşılığı) sahte bir transport
// enjekte edilebilsin.

import Foundation

public struct PlanHTTPResult: Sendable {
    public let statusCode: Int
    public let body: Data

    public init(statusCode: Int, body: Data) {
        self.statusCode = statusCode
        self.body = body
    }
}

public protocol PlanHTTPTransport: Sendable {
    func send(requestBody: Data) async throws -> PlanHTTPResult
}
public protocol OperationBoundPlanHTTPTransport: PlanHTTPTransport {
    func send(requestBody: Data, operationID: UUID) async throws -> PlanHTTPResult
}

/// Missing credentials are guest; a credential-store failure must throw, not silently become guest.
public protocol PlanCredentialSource: Sendable {
    func planSession() async throws -> SecureAccountSession?
}

/// No authenticated redirect is followed, even to the same host. Reconfiguration must be explicit.
final class PlanCredentialRedirectBlocker: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Gerçek `URLSession` tabanlı taşıma — yalnızca `serve()` çalışan gerçek
/// bir backend'e karşı elle/production'da kullanılır, XCTest'te DEĞİL.
public struct URLSessionPlanTransport: OperationBoundPlanHTTPTransport {
    /// Two sequential provider attempts may each consume 20 seconds. Leave
    /// ten seconds for transport/validation overhead; no automatic retry.
    /// This client budget is not a guarantee about Render's edge timeout.
    public static let requestTimeout: TimeInterval = 50
    private let url: URL
    private let session: URLSession
    private let credentials: (any PlanCredentialSource)?
    private let credentialOrigin: URL?
    private let anonymousIdentityEnabled: Bool
    private let anonymousCredentials: (any AnonymousCredentialStore)?
    private let now: @Sendable () -> Date

    public init(url: URL, session: URLSession = .shared,
                credentials: (any PlanCredentialSource)? = nil, credentialOrigin: URL? = nil,
                anonymousIdentityEnabled: Bool = false, anonymousCredentials: (any AnonymousCredentialStore)? = nil,
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.url = url
        self.session = session
        self.credentials = credentials
        self.credentialOrigin = credentialOrigin
        self.anonymousIdentityEnabled = anonymousIdentityEnabled
        self.anonymousCredentials = anonymousCredentials
        self.now = now
    }

    private func trustedCredentialTarget() -> Bool {
        guard let origin = credentialOrigin,
              url.scheme?.lowercased() == "https", origin.scheme?.lowercased() == "https",
              let host = url.host, let expectedHost = origin.host,
              !host.isEmpty, host.lowercased() == expectedHost.lowercased(),
              (url.port ?? 443) == (origin.port ?? 443),
              url.user == nil, url.password == nil, origin.user == nil, origin.password == nil
        else { return false }
        return true
    }

    public func send(requestBody: Data) async throws -> PlanHTTPResult {
        try await send(requestBody: requestBody, operationID: UUID())
    }

    public func send(requestBody: Data, operationID: UUID) async throws -> PlanHTTPResult {
        try Task.checkCancellation()
        let account: SecureAccountSession?
        do { account = try await credentials?.planSession() }
        catch { throw PlannerError.plannerUnreachable(message: "Hesap oturumu güvenli biçimde okunamadı.") }
        if anonymousIdentityEnabled && !trustedCredentialTarget() {
            throw PlannerError.plannerUnreachable(message: "Kimlik bu sunucuya güvenli biçimde gönderilemiyor.")
        }
        if let account {
            guard trustedCredentialTarget(), !account.accountID.isEmpty, !account.appleUserID.isEmpty,
                  account.token.range(of: "^[A-Za-z0-9_-]{20,256}$", options: .regularExpression) != nil
            else { throw PlannerError.plannerUnreachable(message: "Hesap oturumu bu plan sunucusuna güvenli biçimde gönderilemiyor.") }
        }
        var anonymous: SecureAnonymousCredential?
        if anonymousIdentityEnabled && account == nil {
            guard let store = anonymousCredentials else { throw PlannerError.plannerUnreachable(message: "Güvenli anonim kimlik deposu kullanılamıyor.") }
            do { anonymous = try await store.anonymousCredential() }
            catch { throw PlannerError.plannerUnreachable(message: "Anonim kimlik güvenli biçimde okunamadı.") }
            if let anonymous {
                guard anonymous.hasValidShape(), anonymous.expiresAt > now(), anonymous.origin == SecureAnonymousCredential.canonicalOrigin(url)
                else { throw PlannerError.serverUnavailable(status: 401) }
            }
        }
        let operation = anonymousIdentityEnabled ? operationID.uuidString.lowercased() : nil
        let result = try await perform(url: url, body: requestBody, account: account, anonymous: anonymous?.token, operation: operation)
        guard anonymousIdentityEnabled, account == nil, anonymous == nil, result.statusCode == 401,
              let object = try? JSONSerialization.jsonObject(with: result.body) as? [String: Any],
              let error = object["error"] as? [String: Any], error["code"] as? String == "identity_required"
        else { return result }
        try Task.checkCancellation()
        // Do not enroll/replay as guest if an account appeared or storage became uncertain.
        do { guard try await credentials?.planSession() == nil else { throw PlannerError.serverUnavailable(status: 401) } }
        catch { throw PlannerError.serverUnavailable(status: 401) }
        guard let origin = credentialOrigin, let canonical = SecureAnonymousCredential.canonicalOrigin(origin), let store = anonymousCredentials else {
            throw PlannerError.serverUnavailable(status: 503)
        }
        do { guard try await store.anonymousCredential() == nil else { throw PlannerError.serverUnavailable(status: 401) } }
        catch { throw PlannerError.serverUnavailable(status: 401) }
        guard let endpoint = URL(string: canonical)?.appendingPathComponent("auth/anonymous") else { throw PlannerError.serverUnavailable(status: 503) }
        let issued = try await perform(url: endpoint, body: Data("{}".utf8), account: nil, anonymous: nil, operation: nil)
        guard issued.statusCode == 200 else { return issued }
        guard issued.body.count <= 4096,
              let fields = try? JSONSerialization.jsonObject(with: issued.body) as? [String: Any],
              Set(fields.keys) == Set(["token", "expiresAt"]), let token = fields["token"] as? String,
              let expiry = fields["expiresAt"] as? String, SecureAnonymousCredential.validToken(token),
              let date = Self.expiryDate(expiry), date > now(), date.timeIntervalSince(now()) <= 31 * 24 * 60 * 60 else {
            throw PlannerError.plannerUnreachable(message: "Anonim kimlik yanıtı doğrulanamadı.")
        }
        try Task.checkCancellation()
        let saved = SecureAnonymousCredential(token: token, expiresAt: date, origin: canonical)
        do { try await store.saveAnonymousCredential(saved) }
        catch { throw PlannerError.plannerUnreachable(message: "Anonim kimlik güvenli biçimde saklanamadı.") }
        try Task.checkCancellation()
        do { guard try await store.anonymousCredential() == saved else { throw PlannerError.serverUnavailable(status: 401) } }
        catch { throw PlannerError.serverUnavailable(status: 401) }
        guard saved.expiresAt > now() else { throw PlannerError.serverUnavailable(status: 401) }
        do { guard try await credentials?.planSession() == nil else { throw PlannerError.serverUnavailable(status: 401) } }
        catch { throw PlannerError.serverUnavailable(status: 401) }
        // Exactly one replay, only after explicit pre-dispatch identity_required denial.
        return try await perform(url: url, body: requestBody, account: nil, anonymous: saved.token, operation: operation)
    }

    private static func expiryDate(_ text: String) -> Date? {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions = [.withInternetDateTime]; return formatter.date(from: text)
    }

    private func perform(url target: URL, body: Data, account: SecureAccountSession?, anonymous: String?, operation: String?) async throws -> PlanHTTPResult {
        try Task.checkCancellation()
        var request = URLRequest(url: target)
        request.httpMethod = "POST"
        request.timeoutInterval = Self.requestTimeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let account { request.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization") }
        else if let anonymous { request.setValue(anonymous, forHTTPHeaderField: "X-Automation-Guest-Token") }
        if let operation { request.setValue(operation, forHTTPHeaderField: "X-Automation-Operation-ID") }
        request.httpBody = body
        let configuration = session.configuration
        configuration.urlCache = nil
        configuration.urlCredentialStorage = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpAdditionalHeaders = configuration.httpAdditionalHeaders?.filter {
            !["authorization", "x-automation-guest-token", "x-automation-operation-id"].contains(String(describing: $0.key).lowercased())
        }
        let boundSession = URLSession(configuration: configuration,
                                      delegate: account == nil && !anonymousIdentityEnabled ? nil : PlanCredentialRedirectBlocker(), delegateQueue: nil)
        defer { boundSession.finishTasksAndInvalidate() }
        let data: Data
        let response: URLResponse
        do { (data, response) = try await boundSession.data(for: request) }
        catch {
            if let urlError = error as? URLError, urlError.code == .timedOut {
                throw URLError(.timedOut) // Preserve the existing timeout mapping without arbitrary userInfo.
            }
            if account != nil || anonymousIdentityEnabled { throw PlannerError.plannerUnreachable(message: "Kimlikli plan isteği tamamlanamadı.") }
            throw error
        }
        guard let http = response as? HTTPURLResponse else {
            throw PlannerError.plannerUnreachable(message: "Geçersiz HTTP yanıtı (HTTPURLResponse değil).")
        }
        if anonymousIdentityEnabled {
            guard let responseURL = http.url, SecureAnonymousCredential.canonicalOrigin(responseURL) == SecureAnonymousCredential.canonicalOrigin(url) else {
                throw PlannerError.plannerUnreachable(message: "Beklenmeyen kimlik sunucusu yanıtı.")
            }
        }
        return PlanHTTPResult(statusCode: http.statusCode, body: data)
    }
}
