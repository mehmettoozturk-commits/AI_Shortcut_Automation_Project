import Foundation
import XCTest
@testable import AutomationCore

private final class BudgetURLProtocol: URLProtocol {
    static let lock = NSLock()
    static var capturedTimeout: TimeInterval?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.capturedTimeout = request.timeoutInterval; Self.lock.unlock()
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class PlanTransportBudgetTests: XCTestCase {
    func testRequestBudgetCoversTwoProviderAttemptsWithoutNetwork() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [BudgetURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let transport = URLSessionPlanTransport(url: URL(string: "https://example.invalid/plan")!, session: session)
        _ = try await transport.send(requestBody: Data("{}".utf8))
        let timeout = readCapturedTimeout()
        XCTAssertEqual(timeout, 50)
        XCTAssertGreaterThan(try XCTUnwrap(timeout), 2 * 20)
    }

    private func readCapturedTimeout() -> TimeInterval? {
        BudgetURLProtocol.lock.lock(); defer { BudgetURLProtocol.lock.unlock() }
        return BudgetURLProtocol.capturedTimeout
    }
}
