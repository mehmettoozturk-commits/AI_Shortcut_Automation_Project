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

/// Gerçek `URLSession` tabanlı taşıma — yalnızca `serve()` çalışan gerçek
/// bir backend'e karşı elle/production'da kullanılır, XCTest'te DEĞİL.
public struct URLSessionPlanTransport: PlanHTTPTransport {
    private let url: URL
    private let session: URLSession

    public init(url: URL, session: URLSession = .shared) {
        self.url = url
        self.session = session
    }

    public func send(requestBody: Data) async throws -> PlanHTTPResult {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = requestBody
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw PlannerError.plannerUnreachable(message: "Geçersiz HTTP yanıtı (HTTPURLResponse değil).")
        }
        return PlanHTTPResult(statusCode: http.statusCode, body: data)
    }
}
