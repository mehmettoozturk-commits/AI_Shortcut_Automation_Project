// DSL/Registry kontrat testleri.
//
// ⚠️ BU TESTLER XCODE'DA ÇALIŞTIRILMADI (bkz. Package.swift üst notu).
// Burada bulunma amaçları: Phase 3B'de ilk `swift test` çalıştığında
// doğrulanacak somut, yazılı beklentiler bırakmak. Fixture'lar gerçek
// TS zod şemasından geçmiş veridir (contracts/generate.mjs ile
// üretildi, node ile ÇALIŞTIRILDI ve doğrulandı).

import XCTest
@testable import AutomationCore

final class DSLContractTests: XCTestCase {
    func loadFixture() throws -> [String: AutomationPlanDTO] {
        let url = Bundle.module.url(forResource: "automation-plan-samples", withExtension: "json")!
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode([String: AutomationPlanDTO].self, from: data)
    }

    func testDecodesVehicleSentryFixture() throws {
        let fixtures = try loadFixture()
        let plan = try XCTUnwrap(fixtures["vehicleSentry"])
        XCTAssertEqual(plan.trigger.type, "ios.bluetooth.disconnected")
        XCTAssertEqual(plan.trigger.device, "Tesla Model Y")
        XCTAssertEqual(plan.steps.count, 2)
        guard case .askConfirmation(let message) = plan.steps[0] else {
            return XCTFail("İlk adım ask_confirmation olmalı")
        }
        XCTAssertEqual(message, "Sentry Mode'u açmak ister misin?")
        guard case .conditional(_, let then, let elseSteps) = plan.steps[1] else {
            return XCTFail("İkinci adım conditional olmalı")
        }
        XCTAssertEqual(elseSteps.count, 0)
        guard case .action(let type, _) = then[0] else {
            return XCTFail("then[0] action olmalı")
        }
        XCTAssertEqual(type, "tesla.sentry_mode.toggle")
    }

    func testDecodesDailyReminderFixture() throws {
        let fixtures = try loadFixture()
        let plan = try XCTUnwrap(fixtures["dailyReminder"])
        XCTAssertEqual(plan.trigger.type, "ios.time_of_day.daily")
        XCTAssertEqual(plan.steps.count, 1)
    }

    func testRoundTripEncodingPreservesShape() throws {
        let fixtures = try loadFixture()
        let plan = try XCTUnwrap(fixtures["vehicleSentry"])
        let reencoded = try JSONEncoder().encode(plan)
        let decoded = try JSONDecoder().decode(AutomationPlanDTO.self, from: reencoded)
        XCTAssertEqual(plan, decoded)
    }

    func testFlattenStepsMatchesTSBehavior() throws {
        let fixtures = try loadFixture()
        let plan = try XCTUnwrap(fixtures["vehicleSentry"])
        let flat = flattenSteps(plan.steps)
        // ask_confirmation + conditional + (then içindeki) action = 3
        XCTAssertEqual(flat.count, 3)
    }
}

final class CapabilityRegistryContractTests: XCTestCase {
    func loadRegistry() throws -> CapabilityRegistry {
        try CapabilityRegistry.loadFromBundle()
    }

    func testLoadsAllFifteenCapabilities() throws {
        let registry = try loadRegistry()
        XCTAssertEqual(registry.capabilities.count, 15)
    }

    func testRejectsUnprovenAutomaticInstall() throws {
        var bad = try loadRegistry().capabilities
        bad[0].installMethod = .automatic
        XCTAssertThrowsError(try CapabilityRegistry(capabilities: bad)) { error in
            guard case CapabilityRegistryError.contractViolation = error else {
                return XCTFail("contractViolation bekleniyordu, \(error) geldi")
            }
        }
    }

    func testBluetoothBehaviorDiffersByOSVersion() throws {
        let registry = try loadRegistry()
        let bt = try XCTUnwrap(registry.find("ios.bluetooth.disconnected"))
        XCTAssertEqual(CapabilityBehavior.canRunWithoutAsking(bt, osVersion: 15), .no)
        XCTAssertEqual(CapabilityBehavior.canRunWithoutAsking(bt, osVersion: 26), .yes)
    }

    func testResolverPrefersCarPlayOverBluetooth() throws {
        let registry = try loadRegistry()
        let withCarPlay = DeviceContext(osVersion: 26, hasCarPlay: true)
        let resolution = CapabilityResolver.resolveTrigger(group: "vehicle_departure", registry: registry, device: withCarPlay)
        XCTAssertEqual(resolution?.capability.id, "ios.carplay.disconnected")
    }

    func testResolverFallsBackToBluetoothWithoutCarPlay() throws {
        let registry = try loadRegistry()
        let noCarPlay = DeviceContext(osVersion: 26, hasCarPlay: false)
        let resolution = CapabilityResolver.resolveTrigger(group: "vehicle_departure", registry: registry, device: noCarPlay)
        XCTAssertEqual(resolution?.capability.id, "ios.bluetooth.disconnected")
    }
}
