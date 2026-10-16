import Foundation
import XCTest
@testable import AutomationCore

private func operationReply(_ status: Int = 200, conversation: String? = nil) -> PlanHTTPResult {
    let marker = conversation.map { ",\"conversation\":{\"marker\":\"\($0)\"}" } ?? ""
    return PlanHTTPResult(statusCode: status, body: Data("{\"status\":\"not_understood\"\(marker)}".utf8))
}
private actor OperationRecordingTransport: OperationBoundPlanHTTPTransport {
    var ids: [UUID] = [], bodies: [Data] = []
    var replies: [PlanHTTPResult]
    var timeouts: Int
    let holdFirst: Bool
    var held: CheckedContinuation<PlanHTTPResult, Error>?
    var entered: CheckedContinuation<Void,Never>?
    init(_ replies: [PlanHTTPResult] = [], timeouts: Int = 0, holdFirst: Bool = false) { self.replies = replies; self.timeouts = timeouts; self.holdFirst = holdFirst }
    func send(requestBody: Data) async throws -> PlanHTTPResult { XCTFail("Expected operation-aware transport"); return operationReply() }
    func send(requestBody: Data, operationID: UUID) async throws -> PlanHTTPResult {
        ids.append(operationID); bodies.append(requestBody)
        if holdFirst && ids.count == 1 {
            return try await withCheckedThrowingContinuation { continuation in held = continuation; entered?.resume(); entered = nil }
        }
        if timeouts > 0 { timeouts -= 1; throw URLError(.timedOut) }
        return replies.isEmpty ? operationReply() : replies.removeFirst()
    }
    func waitForHeldRequest() async {
        if held != nil { return }
        await withCheckedContinuation { entered = $0 }
    }
    func finishHeld(_ response: PlanHTTPResult) { let c = held; held = nil; c?.resume(returning: response) }
}
final class PlanOperationIdentityTests: XCTestCase {
    private func planner(_ transport: any PlanHTTPTransport) -> HTTPBackedPlanner {
        HTTPBackedPlanner(transport: transport, permissions: MockPermissionService())
    }
    func testTimeoutRetrySameBodySameUUIDThenSuccessStartsNewTurn() async {
        let transport=OperationRecordingTransport(timeouts:1),p=planner(transport)
        _ = await p.plan(text:"same text",existingDraft:nil);let timeout=await p.lastError;XCTAssertEqual(timeout,.requestTimedOut)
        _ = await p.plan(text:"same text",existingDraft:nil)
        _ = await p.plan(text:"same text",existingDraft:nil)
        let ids=await transport.ids,bodies=await transport.bodies
        XCTAssertEqual(ids.count,3);XCTAssertEqual(ids[0],ids[1]);XCTAssertNotEqual(ids[1],ids[2]);XCTAssertEqual(bodies[0],bodies[1])
    }
    func testChangedBodyCreatesNewUUIDEvenAfterFailure() async {
        let transport=OperationRecordingTransport([operationReply(503),operationReply()]),p=planner(transport)
        _ = await p.plan(text:"first",existingDraft:nil);_ = await p.plan(text:"second",existingDraft:nil)
        let ids=await transport.ids;XCTAssertNotEqual(ids[0],ids[1])
    }
    func testResetStartsNewLogicalAttemptForIdenticalText() async {
        let transport=OperationRecordingTransport([operationReply(503),operationReply()]),p=planner(transport)
        _ = await p.plan(text:"same",existingDraft:nil);p.resetConversation();_ = await p.plan(text:"same",existingDraft:nil)
        let ids=await transport.ids;XCTAssertNotEqual(ids[0],ids[1])
    }
    func testHTTP401409429503PreservePendingAndMapDistinctStatus() async {
        for status in [401,409,429,503] {
            let transport=OperationRecordingTransport([operationReply(status),operationReply(status)]),p=planner(transport)
            _ = await p.plan(text:"same",existingDraft:nil);let error=await p.lastError;XCTAssertEqual(error,.serverUnavailable(status:status))
            _ = await p.plan(text:"same",existingDraft:nil);let ids=await transport.ids;XCTAssertEqual(ids[0],ids[1]);XCTAssertEqual(ids.count,2)
        }
    }
    func testTerminal422ClearsPendingButPreservesValidationError() async {
        let body=Data("""
        {"status":"plan","plan":{"name":"Synthetic","trigger":{"type":"ios.battery.falls_below","device":null,"params":{"level":20}},"steps":[{"type":"ios.notification.show"}],"missing":[],"answers":{}},"validation":{"ok":false,"issues":[{"code":"missing_permission","message":"Synthetic permission"}]}}
        """.utf8)
        let transport=OperationRecordingTransport([PlanHTTPResult(statusCode:422,body:body),operationReply()]),p=planner(transport)
        let result=await p.plan(text:"same",existingDraft:nil)
        if case .validationBlocked = result {} else { XCTFail("Expected validation result") }
        let error=await p.lastError;XCTAssertEqual(error,.validationFailed(issues:["Synthetic permission"]))
        _ = await p.plan(text:"same",existingDraft:nil);let ids=await transport.ids;XCTAssertNotEqual(ids[0],ids[1])
    }
    func testMalformed422DoesNotAuthorizeANewRetryOperation() async {
        let transport=OperationRecordingTransport([operationReply(422),operationReply(422)]),p=planner(transport)
        _ = await p.plan(text:"same",existingDraft:nil);_ = await p.plan(text:"same",existingDraft:nil)
        let ids=await transport.ids;XCTAssertEqual(ids[0],ids[1])
    }
    func testLateSuccessAfterResetCannotOverwriteNewConversationOrPending() async throws {
        let transport=OperationRecordingTransport([operationReply(conversation:"new"),operationReply()],holdFirst:true),p=planner(transport)
        let old=Task { await p.plan(text:"old",existingDraft:nil) };await transport.waitForHeldRequest()
        p.resetConversation();_ = await p.plan(text:"new",existingDraft:nil)
        // Deliberately uncooperative transport resumes after task cancellation.
        await transport.finishHeld(operationReply(conversation:"old"));let stale=await old.value
        if case .notUnderstood = stale {} else { XCTFail("Stale response escaped") }
        _ = await p.plan(text:"next",existingDraft:nil)
        let bodies=await transport.bodies
        let third=try XCTUnwrap(try JSONSerialization.jsonObject(with:bodies[2]) as? [String:Any])
        XCTAssertEqual((third["conversation"] as? [String:Any])?["marker"] as? String,"new")
    }
    func testLateErrorAfterResetCannotOverwriteNewErrorOrRetryUUID() async {
        let transport=OperationRecordingTransport([operationReply(429),operationReply()],holdFirst:true),p=planner(transport)
        let old=Task { await p.plan(text:"old",existingDraft:nil) };await transport.waitForHeldRequest()
        p.resetConversation();_ = await p.plan(text:"new",existingDraft:nil)
        let before=await p.lastError;XCTAssertEqual(before,.serverUnavailable(status:429))
        await transport.finishHeld(operationReply(503));_ = await old.value
        let after=await p.lastError;XCTAssertEqual(after,.serverUnavailable(status:429))
        _ = await p.plan(text:"new",existingDraft:nil);let ids=await transport.ids;XCTAssertEqual(ids[1],ids[2]);XCTAssertNotEqual(ids[0],ids[1])
    }
    func testConcurrentDuplicateSubmitDoesNotCreateSecondInFlightOperation() async {
        let transport=OperationRecordingTransport(holdFirst:true),p=planner(transport)
        let old=Task { await p.plan(text:"same",existingDraft:nil) };await transport.waitForHeldRequest()
        _ = await p.plan(text:"same",existingDraft:nil);let ids=await transport.ids;XCTAssertEqual(ids.count,1)
        await transport.finishHeld(operationReply());_ = await old.value
    }
    @MainActor private func machine(_ planner: HTTPBackedPlanner) throws -> BuilderMachine {
        BuilderMachine(registry: try CapabilityRegistry.loadFromBundle(), planner: planner, permissions: MockPermissionService(),
                       setup: MockSetupService(), shortcutsHandoff: MockShortcutsHandoff(), repository: InMemoryAutomationRepository(),
                       device: DeviceContext(osVersion: 26, hasCarPlay: false))
    }
    @MainActor func testActualBuilderLateResponseCannotReplaceNewAttempt() async throws {
        let transport=OperationRecordingTransport(holdFirst:true),p=planner(transport),m=try machine(p)
        await m.open(prefillText:"old")
        let old=Task { await m.submit() };await transport.waitForHeldRequest()
        await m.close();await m.open(prefillText:"new")
        await transport.finishHeld(operationReply(503));await old.value
        if case .capturing(let text,let draft,let misunderstood)=m.step {
            XCTAssertEqual(text,"new");XCTAssertNil(draft);XCTAssertFalse(misunderstood)
        } else { XCTFail("New attempt was overwritten") }
        XCTAssertNil(m.plannerFailure)
    }
    @MainActor func testActualBuilderNewSubmitResultWinsOverOlderResponse() async throws {
        let transport=OperationRecordingTransport([operationReply(429)],holdFirst:true),p=planner(transport),m=try machine(p)
        await m.open(prefillText:"old")
        let old=Task { await m.submit() };await transport.waitForHeldRequest()
        m.setText("new");await m.submit()
        XCTAssertEqual(m.plannerFailure,.serverUnavailable(status:429))
        await transport.finishHeld(operationReply());await old.value
        XCTAssertEqual(m.plannerFailure,.serverUnavailable(status:429))
        if case .capturing(let text,_,let misunderstood)=m.step { XCTAssertEqual(text,"new");XCTAssertTrue(misunderstood) }
        else { XCTFail("New result was overwritten") }
    }
    @MainActor func testActualBuilderSupersedingIdenticalSubmitRetainsUncertainOperationID() async throws {
        let transport=OperationRecordingTransport([operationReply(409)],holdFirst:true),p=planner(transport),m=try machine(p)
        await m.open(prefillText:"same")
        let old=Task { await m.submit() };await transport.waitForHeldRequest()
        await m.submit();let ids=await transport.ids
        XCTAssertEqual(ids.count,2);XCTAssertEqual(ids[0],ids[1]);XCTAssertEqual(m.plannerFailure,.serverUnavailable(status:409))
        await transport.finishHeld(operationReply());await old.value
        XCTAssertEqual(m.plannerFailure,.serverUnavailable(status:409))
    }
}
