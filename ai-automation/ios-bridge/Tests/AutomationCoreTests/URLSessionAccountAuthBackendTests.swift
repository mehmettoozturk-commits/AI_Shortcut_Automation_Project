import Foundation
import XCTest
@testable import AutomationCore

private final class StubAuthURLProtocol: URLProtocol {
    static var responseCode = 200
    static var responseBody = Data()
    static var requests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        let response = HTTPURLResponse(
            url: request.url!, statusCode: Self.responseCode,
            httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class URLSessionAccountAuthBackendTests: XCTestCase {
    override func setUp() { super.setUp(); StubAuthURLProtocol.requests = [] }
    private func jsonBody(_ request: URLRequest) throws -> [String: Any] {
        if let data = request.httpBody { return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any]) }
        let stream = try XCTUnwrap(request.httpBodyStream)
        stream.open(); defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(contentsOf: buffer.prefix(count))
        }
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
    private func makeBackend() throws -> URLSessionAccountAuthBackend {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubAuthURLProtocol.self]
        return try URLSessionAccountAuthBackend(
            baseURL: URL(string: "https://example.invalid:3443")!,
            session: URLSession(configuration: configuration)
        )
    }

    func testPlainHTTPAuthURLIsRejectedBeforeAnyRequest() {
        XCTAssertThrowsError(try URLSessionAccountAuthBackend(baseURL: URL(string: "http://192.168.1.116:3443")!))
    }

    func testChallengeUsesExpectedBackendContract() async throws {
        StubAuthURLProtocol.responseCode = 200
        StubAuthURLProtocol.responseBody = Data(#"{"challengeId":"id-1","nonce":"server-nonce"}"#.utf8)
        let challenge = try await makeBackend().challenge()
        XCTAssertEqual(challenge.id, "id-1")
        XCTAssertEqual(challenge.nonce, "server-nonce")
    }

    func testUnauthorizedSessionIsInvalidButAlreadyRevokedLogoutSucceeds() async throws {
        StubAuthURLProtocol.responseCode = 401
        StubAuthURLProtocol.responseBody = Data(#"{"error":"invalid"}"#.utf8)
        let backend = try makeBackend()
        let valid = try await backend.validate(token: "opaque-token")
        let revoked = try await backend.revoke(token: "opaque-token")
        XCTAssertFalse(valid)
        XCTAssertTrue(revoked)
    }

    func testMissingAccountRequiresConsentRatherThanSession() async throws {
        StubAuthURLProtocol.responseCode = 200
        StubAuthURLProtocol.responseBody = Data(#"{"status":"account_creation_required","creationTicket":"opaque-fixture-ticket"}"#.utf8)
        do {
            _ = try await makeBackend().exchange(identityToken: "fixture", challenge: AppleAuthChallenge(id: "id", nonce: "nonce"))
            XCTFail("Must not return a linked session")
        } catch AccountBackendError.creationRequired(let ticket) {
            XCTAssertEqual(ticket, "opaque-fixture-ticket")
        }
    }

    func testCreationChallengeUsesFreshNonce() async throws {
        StubAuthURLProtocol.responseCode = 200
        StubAuthURLProtocol.responseBody = Data(#"{"challengeId":"create-id","nonce":"fresh-nonce"}"#.utf8)
        let challenge = try await makeBackend().creationChallenge(ticket: "fixture-ticket")
        XCTAssertEqual(challenge.id, "create-id")
        XCTAssertEqual(challenge.nonce, "fresh-nonce")
    }

    func testCreationErrorCodesRemainDistinct() async throws {
        for code in [409, 410, 426] {
            StubAuthURLProtocol.responseCode = code
            StubAuthURLProtocol.responseBody = Data("{}".utf8)
            do {
                _ = try await makeBackend().createAccount(ticket: "fixture", identityToken: "fixture", challenge: AppleAuthChallenge(id: "id", nonce: "nonce"))
                XCTFail("Expected error")
            } catch AccountBackendError.accountExists { XCTAssertEqual(code, 409) }
              catch AccountBackendError.creationExpired { XCTAssertEqual(code, 410) }
              catch AccountBackendError.updateRequired { XCTAssertEqual(code, 426) }
        }
    }

    func testCreationChallengeExactRequestContainsOnlyTicket() async throws {
        StubAuthURLProtocol.responseCode = 200
        StubAuthURLProtocol.responseBody = Data(#"{"challengeId":"create-id","nonce":"fresh-nonce"}"#.utf8)
        _ = try await makeBackend().creationChallenge(ticket: "fixture-ticket")
        let request = try XCTUnwrap(StubAuthURLProtocol.requests.last)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/auth/accounts/challenge")
        XCTAssertNil(request.url?.query)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        let body = try jsonBody(request)
        XCTAssertEqual(Set(body.keys), ["creationTicket"])
        XCTAssertEqual(body["creationTicket"] as? String, "fixture-ticket")
    }

    func testCreateExactRequestContainsConsentFreshProofAndUniqueRequestID() async throws {
        StubAuthURLProtocol.responseCode = 200
        StubAuthURLProtocol.responseBody = Data(#"{"status":"created","userId":"fixture-user","sessionToken":"fixture-session"}"#.utf8)
        _ = try await makeBackend().createAccount(ticket: "fixture-ticket", identityToken: "fresh-proof", challenge: AppleAuthChallenge(id: "creation-id", nonce: "fresh-nonce"))
        let request = try XCTUnwrap(StubAuthURLProtocol.requests.last)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/auth/accounts")
        XCTAssertNil(request.url?.query)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        let body = try jsonBody(request)
        XCTAssertEqual(Set(body.keys), ["creationTicket", "confirmCreate", "requestId", "challengeId", "nonce", "identityToken"])
        XCTAssertEqual(body["creationTicket"] as? String, "fixture-ticket")
        XCTAssertEqual(body["confirmCreate"] as? Bool, true)
        XCTAssertEqual(body["challengeId"] as? String, "creation-id")
        XCTAssertEqual(body["nonce"] as? String, "fresh-nonce")
        XCTAssertEqual(body["identityToken"] as? String, "fresh-proof")
        XCTAssertNotNil(UUID(uuidString: try XCTUnwrap(body["requestId"] as? String)))
        XCTAssertEqual(StubAuthURLProtocol.requests.count, 1)
    }
}
