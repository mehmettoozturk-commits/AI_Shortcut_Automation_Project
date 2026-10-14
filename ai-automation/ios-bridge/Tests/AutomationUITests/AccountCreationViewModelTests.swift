import XCTest
@testable import AutomationCore
@testable import AutomationUI

private actor ConsentStore: AccountStateStore {
    var state: AccountState = .guest
    func load() async -> AccountState { state }
    func save(_ state: AccountState) async -> Bool { self.state = state; return true }
}
private actor ConsentAuthorizer: AccountAuthorizer {
    var creations = 0
    func authorize() async -> AccountAuthorization { .creationRequired(appleUserID: "fixture", ticket: "fixture-ticket") }
    func credentialState(for appleUserID: String) async -> AccountCredentialState { .authorized }
    func createAccount(appleUserID: String, ticket: String) async -> AccountAuthorization { creations += 1; return .authorized(appleUserID: appleUserID) }
}
@MainActor
final class AccountCreationViewModelTests: XCTestCase {
    private func fixture() throws -> (BuilderViewModel, ConsentAuthorizer) {
        let registry = try CapabilityRegistry.loadFromBundle()
        let repository = InMemoryAutomationRepository()
        let machine = BuilderMachine(registry: registry, planner: MockPlanner(registry: registry), permissions: MockPermissionService(granted: []), setup: MockSetupService(), shortcutsHandoff: MockShortcutsHandoff(), repository: repository, device: DeviceContext(osVersion: 26, hasCarPlay: false))
        let authorizer = ConsentAuthorizer()
        let account = AccountService(authorizer: authorizer, store: ConsentStore())
        return (BuilderViewModel(machine: machine, registry: registry, repository: repository, accountService: account, accountLinkAvailable: true), authorizer)
    }
    func testConsentScreenWaitsAndCancelReturnsToGuest() async throws {
        let (model, authorizer) = try fixture()
        await model.linkAccount()
        XCTAssertTrue(model.accountCreationPending)
        XCTAssertEqual(model.accountState, .guest)
        let before = await authorizer.creations
        XCTAssertEqual(before, 0)
        await model.cancelAccountCreation()
        await model.confirmAccountCreation()
        XCTAssertFalse(model.accountCreationPending)
        XCTAssertFalse(model.accountBusy)
        let after = await authorizer.creations
        XCTAssertEqual(after, 0)
    }
    func testExplicitConfirmationLinksOnceAndClearsConsentScreen() async throws {
        let (model, authorizer) = try fixture()
        await model.linkAccount()
        await model.confirmAccountCreation()
        await model.confirmAccountCreation()
        XCTAssertFalse(model.accountCreationPending)
        XCTAssertEqual(model.accountState, .linked(appleUserID: "fixture"))
        let creates = await authorizer.creations
        XCTAssertEqual(creates, 1)
    }
}
