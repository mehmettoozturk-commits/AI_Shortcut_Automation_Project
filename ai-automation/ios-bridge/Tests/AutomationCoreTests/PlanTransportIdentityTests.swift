import Foundation
import Security
import XCTest
@testable import AutomationCore

private let syntheticPlanToken = String(repeating: "a", count: 43)
private let syntheticPlanAccount = SecureAccountSession(appleUserID: "synthetic-apple", accountID: "synthetic-account", token: syntheticPlanToken)

private actor PlanIdentityCredentials: PlanCredentialSource {
    let value: SecureAccountSession?
    let fail: Bool
    init(_ value: SecureAccountSession?, fail: Bool = false) { self.value = value; self.fail = fail }
    func planSession() async throws -> SecureAccountSession? {
        if fail { throw NSError(domain: "synthetic", code: 1, userInfo: [NSLocalizedDescriptionKey: syntheticPlanToken]) }
        return value
    }
}

private final class PlanIdentityURLProtocol: URLProtocol {
    static let lock = NSLock()
    static var requests: [URLRequest] = []
    static var failure: URLError?
    static func reset(_ error: URLError? = nil) { lock.lock(); defer { lock.unlock() }; requests = []; failure = error }
    static func captured() -> [URLRequest] { lock.lock(); defer { lock.unlock() }; return requests }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.requests.append(request); let failure = Self.failure; Self.lock.unlock()
        if let failure { client?.urlProtocol(self, didFailWithError: failure); return }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{}".utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class PlanTransportIdentityTests: XCTestCase {
    private let origin = URL(string: "https://plan.example.invalid")!
    override func setUp() { PlanIdentityURLProtocol.reset() }
    private func session(defaultAuthorization: String? = nil) -> URLSession {
        let c = URLSessionConfiguration.ephemeral; c.protocolClasses = [PlanIdentityURLProtocol.self]
        if let defaultAuthorization { c.httpAdditionalHeaders = ["Authorization": defaultAuthorization] }
        return URLSession(configuration: c)
    }
    private func transport(_ session: URLSession, source: (any PlanCredentialSource)? = nil,
                           url: URL? = nil, credentialOrigin: URL? = nil) -> URLSessionPlanTransport {
        URLSessionPlanTransport(url: url ?? origin.appendingPathComponent("plan"), session: session,
                                credentials: source, credentialOrigin: credentialOrigin ?? origin)
    }
    func testAccountTokenSentOnlyToMatchingHTTPSOriginAndNoCache() async throws {
        let s = session(); defer { s.invalidateAndCancel() }
        _ = try await transport(s, source: PlanIdentityCredentials(syntheticPlanAccount)).send(requestBody: Data("{}".utf8))
        let requests = PlanIdentityURLProtocol.captured(); XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests[0].value(forHTTPHeaderField: "Authorization"), "Bearer \(syntheticPlanToken)")
        XCTAssertEqual(requests[0].cachePolicy, .reloadIgnoringLocalCacheData)
        XCTAssertEqual(requests[0].url?.host, origin.host)
    }
    func testMissingCredentialDoesNotAcquireAccountFromDefaultSessionHeaders() async throws {
        let s = session(defaultAuthorization: "Bearer default-header-not-identity"); defer { s.invalidateAndCancel() }
        _ = try await transport(s, source: PlanIdentityCredentials(nil)).send(requestBody: Data("{}".utf8))
        XCTAssertEqual(PlanIdentityURLProtocol.captured().count, 1)
        XCTAssertNil(PlanIdentityURLProtocol.captured()[0].value(forHTTPHeaderField: "Authorization"))
    }
    func testCredentialStoreErrorSendsNothingAndRedactsError() async {
        let s = session(); defer { s.invalidateAndCancel() }
        do { _ = try await transport(s, source: PlanIdentityCredentials(nil, fail: true)).send(requestBody: Data())
            XCTFail("Expected read failure")
        } catch { XCTAssertFalse(String(describing: error).contains(syntheticPlanToken)) }
        XCTAssertEqual(PlanIdentityURLProtocol.captured().count, 0)
    }
    func testAccountOriginMismatchDowngradeUserinfoAndMissingOriginSendNothing() async {
        let urls = ["http://plan.example.invalid/plan", "https://other.example.invalid/plan",
                    "https://plan.example.invalid:444/plan", "https://user@plan.example.invalid/plan"]
        let s = session(); defer { s.invalidateAndCancel() }
        for raw in urls {
            do { _ = try await transport(s, source: PlanIdentityCredentials(syntheticPlanAccount), url: URL(string: raw)!).send(requestBody: Data()); XCTFail("Expected origin rejection") }
            catch { XCTAssertFalse(String(describing: error).contains(syntheticPlanToken)) }
        }
        let noOrigin = URLSessionPlanTransport(url: origin.appendingPathComponent("plan"), session: s, credentials: PlanIdentityCredentials(syntheticPlanAccount))
        do { _ = try await noOrigin.send(requestBody: Data()); XCTFail("Expected missing origin rejection") } catch {}
        XCTAssertEqual(PlanIdentityURLProtocol.captured().count, 0)
    }
    func testExplicitDefaultPortAndCaseInsensitiveHostMatch() async throws {
        let s = session(); defer { s.invalidateAndCancel() }
        _ = try await transport(s, source: PlanIdentityCredentials(syntheticPlanAccount),
                                url: URL(string: "https://PLAN.example.invalid:443/plan")!).send(requestBody: Data())
        XCTAssertEqual(PlanIdentityURLProtocol.captured().count, 1)
    }
    func testMalformedTokenNeverBecomesGuestOrAppearsInErrors() async {
        let s = session(); defer { s.invalidateAndCancel() }
        for token in ["", "short", "bad\r\nAuthorization: injected", String(repeating: "b", count: 257)] {
            let account = SecureAccountSession(appleUserID: "a", accountID: "b", token: token)
            do { _ = try await transport(s, source: PlanIdentityCredentials(account)).send(requestBody: Data()); XCTFail("Expected malformed credential rejection") }
            catch { if !token.isEmpty { XCTAssertFalse(String(describing: error).contains(token)) } }
        }
        XCTAssertEqual(PlanIdentityURLProtocol.captured().count, 0)
    }
    func testAuthenticatedTransportFailureDoesNotRetryOrExposeArbitraryErrorUserInfo() async {
        PlanIdentityURLProtocol.reset(URLError(.networkConnectionLost, userInfo: [NSLocalizedDescriptionKey: syntheticPlanToken]))
        let s = session(); defer { s.invalidateAndCancel() }
        do { _ = try await transport(s, source: PlanIdentityCredentials(syntheticPlanAccount)).send(requestBody: Data()); XCTFail("Expected network error") }
        catch { XCTAssertFalse(String(describing: error).contains(syntheticPlanToken)) }
        XCTAssertEqual(PlanIdentityURLProtocol.captured().count, 1)
    }
    func testAuthenticatedTimeoutPreservesTypedTimeoutWithoutUserInfo() async {
        PlanIdentityURLProtocol.reset(URLError(.timedOut, userInfo: [NSLocalizedDescriptionKey: syntheticPlanToken]))
        let s = session(); defer { s.invalidateAndCancel() }
        do { _ = try await transport(s, source: PlanIdentityCredentials(syntheticPlanAccount)).send(requestBody: Data()); XCTFail("Expected timeout") }
        catch { XCTAssertEqual((error as? URLError)?.code, .timedOut); XCTAssertFalse(String(describing: error).contains(syntheticPlanToken)) }
        XCTAssertEqual(PlanIdentityURLProtocol.captured().count, 1)
    }
    func testNoCredentialRedirectIsFollowedEvenSameOrigin() {
        let s = session(); defer { s.invalidateAndCancel() }; let blocker = PlanCredentialRedirectBlocker()
        let task = s.dataTask(with: origin); defer { task.cancel() }
        for raw in ["https://other.example.invalid/plan", "http://plan.example.invalid/plan", "https://plan.example.invalid/other"] {
            let response = HTTPURLResponse(url: origin, statusCode: 302, httpVersion: nil, headerFields: ["Location": raw])!
            var called = false
            blocker.urlSession(s, task: task, willPerformHTTPRedirection: response, newRequest: URLRequest(url: URL(string: raw)!)) {
                called = true; XCTAssertNil($0)
            }
            XCTAssertTrue(called)
        }
        XCTAssertEqual(PlanIdentityURLProtocol.captured().count, 0)
    }
    func testStrictKeychainMissingReadErrorDecodeErrorAndValidSyntheticData() async throws {
        let missing = KeychainSessionStore(service: "synthetic-only", copyMatching: { _, _ in errSecItemNotFound })
        let noItem = try await missing.planSession(); XCTAssertNil(noItem)
        let denied = KeychainSessionStore(service: "synthetic-only", copyMatching: { _, _ in errSecInteractionNotAllowed })
        do { _ = try await denied.planSession(); XCTFail("Expected denied read") } catch {}
        let legacy = await denied.load(); XCTAssertNil(legacy)
        let malformed = KeychainSessionStore(service: "synthetic-only", copyMatching: { _, result in result?.pointee = Data("invalid".utf8) as CFData; return errSecSuccess })
        do { _ = try await malformed.planSession(); XCTFail("Expected decode failure") } catch {}
        let data = try JSONEncoder().encode(syntheticPlanAccount)
        let valid = KeychainSessionStore(service: "synthetic-only", copyMatching: { _, result in result?.pointee = data as CFData; return errSecSuccess })
        let decoded = try await valid.planSession(); XCTAssertEqual(decoded, syntheticPlanAccount)
        let s = session(); defer { s.invalidateAndCancel() }
        do { _ = try await transport(s, source: malformed).send(requestBody: Data()); XCTFail("Expected decode fail-closed") } catch {}
        XCTAssertEqual(PlanIdentityURLProtocol.captured().count, 0)
    }
}
