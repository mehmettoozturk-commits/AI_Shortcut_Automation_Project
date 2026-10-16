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
public struct URLSessionPlanTransport: PlanHTTPTransport {
    /// Two sequential provider attempts may each consume 20 seconds. Leave
    /// ten seconds for transport/validation overhead; no automatic retry.
    /// This client budget is not a guarantee about Render's edge timeout.
    public static let requestTimeout: TimeInterval = 50
    private let url: URL
    private let session: URLSession
    private let credentials: (any PlanCredentialSource)?
    private let credentialOrigin: URL?

    public init(url: URL, session: URLSession = .shared,
                credentials: (any PlanCredentialSource)? = nil, credentialOrigin: URL? = nil) {
        self.url = url
        self.session = session
        self.credentials = credentials
        self.credentialOrigin = credentialOrigin
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
        let account: SecureAccountSession?
        do { account = try await credentials?.planSession() }
        catch { throw PlannerError.plannerUnreachable(message: "Hesap oturumu güvenli biçimde okunamadı.") }
        if let account {
            guard trustedCredentialTarget(), !account.accountID.isEmpty, !account.appleUserID.isEmpty,
                  account.token.range(of: "^[A-Za-z0-9_-]{20,256}$", options: .regularExpression) != nil
            else { throw PlannerError.plannerUnreachable(message: "Hesap oturumu bu plan sunucusuna güvenli biçimde gönderilemiyor.") }
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = Self.requestTimeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let account { request.setValue("Bearer \(account.token)", forHTTPHeaderField: "Authorization") }
        request.httpBody = requestBody
        let configuration = session.configuration
        configuration.urlCache = nil
        configuration.urlCredentialStorage = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpAdditionalHeaders = configuration.httpAdditionalHeaders?.filter {
            String(describing: $0.key).lowercased() != "authorization"
        }
        let boundSession = URLSession(configuration: configuration,
                                      delegate: account == nil ? nil : PlanCredentialRedirectBlocker(), delegateQueue: nil)
        defer { boundSession.finishTasksAndInvalidate() }
        let data: Data
        let response: URLResponse
        do { (data, response) = try await boundSession.data(for: request) }
        catch {
            if let urlError = error as? URLError, urlError.code == .timedOut {
                throw URLError(.timedOut) // Preserve the existing timeout mapping without arbitrary userInfo.
            }
            if account != nil { throw PlannerError.plannerUnreachable(message: "Hesaplı plan isteği tamamlanamadı.") }
            throw error
        }
        guard let http = response as? HTTPURLResponse else {
            throw PlannerError.plannerUnreachable(message: "Geçersiz HTTP yanıtı (HTTPURLResponse değil).")
        }
        return PlanHTTPResult(statusCode: http.statusCode, body: data)
    }
}
