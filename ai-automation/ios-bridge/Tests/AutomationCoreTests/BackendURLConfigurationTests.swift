import XCTest
@testable import AutomationCore

final class BackendURLConfigurationTests: XCTestCase {
    private let productionURL = "https://ai-shortcut-plan-api.onrender.com/plan"

    func testReleaseAcceptsProductionHTTPS() {
        XCTAssertEqual(BackendURLConfiguration.resolve(buildValue: productionURL, debugOverride: nil, isDebug: false)?.absoluteString, productionURL)
    }
    func testReleaseRejectsLocalhost() {
        XCTAssertNil(BackendURLConfiguration.resolve(buildValue: "http://localhost:3000/plan", debugOverride: nil, isDebug: false))
    }
    func testReleaseRejectsLANHTTP() {
        XCTAssertNil(BackendURLConfiguration.resolve(buildValue: "http://192.168.1.116:3000/plan", debugOverride: nil, isDebug: false))
    }
    func testReleaseRejectsDifferentHost() {
        XCTAssertNil(BackendURLConfiguration.resolve(buildValue: "https://example.com/plan", debugOverride: nil, isDebug: false))
    }
    func testReleaseIgnoresDebugOverride() {
        XCTAssertEqual(BackendURLConfiguration.resolve(buildValue: productionURL, debugOverride: "http://localhost:3000/plan", isDebug: false)?.absoluteString, productionURL)
    }
    func testReleaseFailsClosedWithoutURL() {
        XCTAssertNil(BackendURLConfiguration.resolve(buildValue: nil, debugOverride: nil, isDebug: false))
    }
    func testDebugAllowsLocalBackend() {
        XCTAssertEqual(BackendURLConfiguration.resolve(buildValue: productionURL, debugOverride: "http://localhost:3000/plan", isDebug: true)?.absoluteString, "http://localhost:3000/plan")
    }
    func testReleaseRejectsCredentials() {
        XCTAssertNil(BackendURLConfiguration.resolve(buildValue: "https://user:pass@ai-shortcut-plan-api.onrender.com/plan", debugOverride: nil, isDebug: false))
    }
}
