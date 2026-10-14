import Foundation

public enum AccountBackendError: Error, Sendable {
    case creationRequired(String)
    case creationExpired
    case accountExists
    case updateRequired
    case insecureURL
    case invalidResponse
    case rejected
}

/// Uses ordinary URLSession TLS validation. No certificate-trust bypass or
/// App Transport Security exception is part of the account path.
public struct URLSessionAccountAuthBackend: AccountAuthBackend {
    private let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) throws {
        guard baseURL.scheme?.lowercased() == "https", baseURL.host != nil else {
            throw AccountBackendError.insecureURL
        }
        self.baseURL = baseURL
        self.session = session
    }

    public func challenge() async throws -> AppleAuthChallenge {
        let response: ChallengeResponse = try await send(path: "auth/apple/challenge", method: "POST", body: Optional<EmptyRequest>.none)
        guard !response.challengeId.isEmpty, !response.nonce.isEmpty else { throw AccountBackendError.invalidResponse }
        return AppleAuthChallenge(id: response.challengeId, nonce: response.nonce)
    }

    public func exchange(identityToken: String, challenge: AppleAuthChallenge) async throws -> BackendAccountSession {
        let body = ExchangeRequest(identityToken: identityToken, challengeId: challenge.id, nonce: challenge.nonce)
        let response: ExchangeResponse = try await send(path: "auth/apple", method: "POST", body: body)
        if response.status == "account_creation_required", let ticket = response.creationTicket, !ticket.isEmpty { throw AccountBackendError.creationRequired(ticket) }
        return try accountSession(response)
    }

    public func creationChallenge(ticket: String) async throws -> AppleAuthChallenge {
        let response: ChallengeResponse = try await send(path: "auth/accounts/challenge", method: "POST", body: TicketRequest(creationTicket: ticket))
        guard !response.challengeId.isEmpty, !response.nonce.isEmpty else { throw AccountBackendError.invalidResponse }
        return AppleAuthChallenge(id: response.challengeId, nonce: response.nonce)
    }

    public func createAccount(ticket: String, identityToken: String, challenge: AppleAuthChallenge) async throws -> BackendAccountSession {
        let response: ExchangeResponse = try await send(path: "auth/accounts", method: "POST", body: CreateRequest(creationTicket: ticket, confirmCreate: true, requestId: UUID().uuidString, challengeId: challenge.id, nonce: challenge.nonce, identityToken: identityToken))
        return try accountSession(response)
    }

    private func accountSession(_ response: ExchangeResponse) throws -> BackendAccountSession {
        guard let id = response.userId, let token = response.sessionToken, !id.isEmpty, !token.isEmpty else { throw AccountBackendError.invalidResponse }
        return BackendAccountSession(accountID: id, token: token)
    }

    public func validate(token: String) async throws -> Bool {
        try await status(path: "auth/session", method: "GET", token: token, invalidMeansDone: false)
    }

    public func revoke(token: String) async throws -> Bool {
        try await status(path: "auth/session", method: "DELETE", token: token, invalidMeansDone: true)
    }

    private func status(path: String, method: String, token: String, invalidMeansDone: Bool) async throws -> Bool {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AccountBackendError.invalidResponse }
        if http.statusCode == 401 { return invalidMeansDone }
        guard http.statusCode == 200 else { throw AccountBackendError.rejected }
        return true
    }

    private func send<Response: Decodable, Body: Encodable>(path: String, method: String, body: Body?) async throws -> Response {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.httpBody = try body.map { try JSONEncoder().encode($0) }
        request.timeoutInterval = 30
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AccountBackendError.invalidResponse }
        if http.statusCode == 410 { throw AccountBackendError.creationExpired }
        if http.statusCode == 409 { throw AccountBackendError.accountExists }
        if http.statusCode == 426 { throw AccountBackendError.updateRequired }
        guard http.statusCode == 200 else { throw AccountBackendError.rejected }
        guard let parsed = try? JSONDecoder().decode(Response.self, from: data) else {
            throw AccountBackendError.invalidResponse
        }
        return parsed
    }

    private struct ChallengeResponse: Decodable { let challengeId: String; let nonce: String }
    private struct EmptyRequest: Encodable {}
    private struct ExchangeRequest: Encodable { let identityToken: String; let challengeId: String; let nonce: String; let accountCreationSupported = true }
    private struct TicketRequest: Encodable { let creationTicket: String }
    private struct CreateRequest: Encodable { let creationTicket: String; let confirmCreate: Bool; let requestId: String; let challengeId: String; let nonce: String; let identityToken: String }
    private struct ExchangeResponse: Decodable { let status: String?; let userId: String?; let sessionToken: String?; let creationTicket: String? }
}
