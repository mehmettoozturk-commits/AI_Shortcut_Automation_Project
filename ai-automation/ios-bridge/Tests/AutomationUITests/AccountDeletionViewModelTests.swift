import XCTest
@testable import AutomationCore
@testable import AutomationUI

private actor DeleteUIStore: AccountStateStore {
    var value: AccountState = .linked(appleUserID: "fixture-user")
    func load() async -> AccountState { value }
    func save(_ state: AccountState) async -> Bool { value = state; return true }
}
private actor DeleteUIAuthorizer: AccountAuthorizer {
    let result: AccountDeletionAuthorization
    var calls = 0
    init(result: AccountDeletionAuthorization) { self.result = result }
    func authorize() async -> AccountAuthorization { .authorized(appleUserID: "fixture-user") }
    func credentialState(for appleUserID: String) async -> AccountCredentialState { .authorized }
    func deleteAccount(appleUserID: String) async -> AccountDeletionAuthorization { calls += 1; return result }
}
@MainActor
final class AccountDeletionViewModelTests: XCTestCase {
    private func fixture(_ result: AccountDeletionAuthorization) async throws -> (BuilderViewModel, DeleteUIAuthorizer) {
        let registry = try CapabilityRegistry.loadFromBundle()
        let repository = InMemoryAutomationRepository()
        let authorizer = DeleteUIAuthorizer(result: result)
        let account = AccountService(authorizer: authorizer, store: DeleteUIStore())
        let machine = BuilderMachine(registry: registry, planner: MockPlanner(registry: registry), permissions: MockPermissionService(granted: []), setup: MockSetupService(), shortcutsHandoff: MockShortcutsHandoff(), repository: repository, device: DeviceContext(osVersion: 26, hasCarPlay: false))
        let model = BuilderViewModel(machine: machine, registry: registry, repository: repository, accountService: account, accountLinkAvailable: true)
        await model.restoreAccount()
        return (model, authorizer)
    }
    func testCommittedDeletionShowsPreservationAndUnconfiguredAppleRevocation() async throws {
        let (model, _) = try await fixture(.deleted(appleRevocation: "not_configured", credentialsCleared: true))
        await model.deleteAccount()
        XCTAssertEqual(model.accountState, .guest)
        XCTAssertFalse(model.accountBusy)
        XCTAssertTrue(model.accountMessage?.contains("otomasyonların ve Kestirmeler'in korundu") == true)
        XCTAssertTrue(model.accountMessage?.contains("henüz yapılandırılmadı") == true)
    }
    func testAppleCancellationKeepsLinkedStateAndReportsCancellation() async throws {
        let (model, _) = try await fixture(.cancelled)
        await model.deleteAccount()
        XCTAssertEqual(model.accountState, .linked(appleUserID: "fixture-user"))
        XCTAssertEqual(model.accountMessage, "Hesap silme iptal edildi.")
    }
    func testUnknownDeletionResultDoesNotAutomaticallyRetryOrClaimLinked() async throws {
        let (model, authorizer) = try await fixture(.unknown)
        await model.deleteAccount()
        XCTAssertEqual(model.accountState, .validationUnavailable(appleUserID: "fixture-user"))
        XCTAssertTrue(model.accountMessage?.contains("doğrulanamadı") == true)
        let calls = await authorizer.calls
        XCTAssertEqual(calls, 1)
    }
    func testIncompleteCleanupDoesNotClaimServerDeletionRolledBack() async throws {
        let (model, _) = try await fixture(.deleted(appleRevocation: "not_configured", credentialsCleared: false))
        await model.deleteAccount()
        XCTAssertEqual(model.accountState, .guest)
        XCTAssertTrue(model.accountMessage?.contains("Sunucudaki hesabın silindi") == true)
        XCTAssertTrue(model.accountMessage?.contains("eski oturum geçerli sayılmıyor") == true)
    }
}
