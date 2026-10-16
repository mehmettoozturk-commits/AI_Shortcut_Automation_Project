import Foundation
import Security
import XCTest
@testable import AutomationCore

private let anonymousOrigin = URL(string: "https://plan.example.invalid")!
private let anonymousToken = String(repeating: "A", count: 43)
private let anonymousNow = Date(timeIntervalSince1970: 1_800_000_000)
private var anonymousRecord: SecureAnonymousCredential {
    SecureAnonymousCredential(token: anonymousToken, expiresAt: anonymousNow.addingTimeInterval(2592000), origin: "https://plan.example.invalid:443")
}
private actor SyntheticAnonymousStore: AnonymousCredentialStore {
    var value: SecureAnonymousCredential?
    var reads = 0, saves = 0
    let failRead: Bool, failSave: Bool
    let appearAt: Int?, replaceAfterSave: Bool
    init(_ value: SecureAnonymousCredential? = nil, failRead: Bool = false, failSave: Bool = false,
         appearAt: Int? = nil, replaceAfterSave: Bool = false) {
        self.value = value; self.failRead = failRead; self.failSave = failSave; self.appearAt = appearAt; self.replaceAfterSave = replaceAfterSave
    }
    func anonymousCredential() async throws -> SecureAnonymousCredential? {
        reads += 1; if failRead { throw NSError(domain: "synthetic", code: 1) }
        if appearAt == reads { return anonymousRecord }; return value
    }
    func saveAnonymousCredential(_ value: SecureAnonymousCredential) async throws {
        saves += 1; if failSave { throw NSError(domain: "synthetic", code: 1) }
        self.value = replaceAfterSave ? SecureAnonymousCredential(token: String(repeating: "B", count: 42) + "A", expiresAt: value.expiresAt, origin: value.origin) : value
    }
}
private actor SyntheticAccountSource: PlanCredentialSource {
    var values: [SecureAccountSession?]
    let fail: Bool
    init(_ values: [SecureAccountSession?] = [nil], fail: Bool = false) { self.values = values; self.fail = fail }
    func planSession() async throws -> SecureAccountSession? {
        if fail { throw NSError(domain: "synthetic", code: 1) }
        if values.count > 1 { return values.removeFirst() }; return values.first ?? nil
    }
}
private final class AnonymousURLProtocol: URLProtocol {
    struct Reply { let status: Int; let body: Data; var url: URL? = nil }
    static let lock = NSLock()
    static var requests: [URLRequest] = [], replies: [Reply] = []
    static var failure: URLError?
    static func reset(_ values: [Reply], failure: URLError? = nil) { lock.lock(); defer { lock.unlock() }; requests = []; replies = values; self.failure = failure }
    static func captured() -> [URLRequest] { lock.lock(); defer { lock.unlock() }; return requests }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.requests.append(request); let failure = Self.failure
        let reply = Self.replies.isEmpty ? Reply(status: 500, body: Data()) : Self.replies.removeFirst(); Self.lock.unlock()
        if let failure { client?.urlProtocol(self, didFailWithError: failure); return }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: reply.url ?? request.url!, statusCode: reply.status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: reply.body); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
private final class SyntheticKeychainCapture: @unchecked Sendable {
    let lock = NSLock(); var attributes: [String:Any] = [:]
    func save(_ value: CFDictionary) { lock.lock(); attributes = value as! [String:Any]; lock.unlock() }
}
final class AnonymousPlanTransportTests: XCTestCase {
    private func reply(_ status: Int, _ body: String = "{}") -> AnonymousURLProtocol.Reply { .init(status: status, body: Data(body.utf8)) }
    private func issued(_ token: String = anonymousToken, expiry: Date? = nil) -> AnonymousURLProtocol.Reply {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.string(from: expiry ?? anonymousRecord.expiresAt)
        return reply(200, "{\"token\":\"\(token)\",\"expiresAt\":\"\(date)\"}")
    }
    private var denied: AnonymousURLProtocol.Reply { reply(401, "{\"error\":{\"code\":\"identity_required\"}}") }
    private func session(defaultHeaders: [String:String]? = nil) -> URLSession {
        let c = URLSessionConfiguration.ephemeral; c.protocolClasses = [AnonymousURLProtocol.self]; c.httpAdditionalHeaders = defaultHeaders
        return URLSession(configuration: c)
    }
    private func transport(_ session: URLSession, store: any AnonymousCredentialStore,
                           enabled: Bool = true, account: (any PlanCredentialSource)? = nil, url: URL? = nil) -> URLSessionPlanTransport {
        URLSessionPlanTransport(url: url ?? anonymousOrigin.appendingPathComponent("plan"), session: session,
                                credentials: account, credentialOrigin: anonymousOrigin,
                                anonymousIdentityEnabled: enabled, anonymousCredentials: store, now: { anonymousNow })
    }
    func testFeatureOffDoesNotReadAnonymousStoreEnrollOrSendOperationHeader() async throws {
        let store = SyntheticAnonymousStore(failRead: true), s = session(defaultHeaders: ["X-Automation-Guest-Token":"stale", "X-Automation-Operation-ID":"stale"]); defer { s.invalidateAndCancel() }
        AnonymousURLProtocol.reset([reply(200)])
        _ = try await transport(s,store:store,enabled:false).send(requestBody:Data())
        let reads = await store.reads; XCTAssertEqual(reads,0)
        XCTAssertEqual(AnonymousURLProtocol.captured().count,1); XCTAssertNil(AnonymousURLProtocol.captured()[0].value(forHTTPHeaderField:"X-Automation-Guest-Token"))
        XCTAssertNil(AnonymousURLProtocol.captured()[0].value(forHTTPHeaderField:"X-Automation-Operation-ID"))
    }
    func testCredentiallessLocalFirstDoesNotEnroll() async throws {
        let store=SyntheticAnonymousStore(), s=session(); defer{s.invalidateAndCancel()}; AnonymousURLProtocol.reset([reply(200)])
        _ = try await transport(s,store:store).send(requestBody:Data(),operationID:UUID()); XCTAssertEqual(AnonymousURLProtocol.captured().count,1)
        let saves=await store.saves; XCTAssertEqual(saves,0)
    }
    func testExplicitDenialEnrollsStoresAndReplaysExactlySameBodyAndUUIDOnce() async throws {
        let store=SyntheticAnonymousStore(),s=session();defer{s.invalidateAndCancel()};AnonymousURLProtocol.reset([denied,issued(),denied])
        let id=UUID(),body=Data("{\"text\":\"synthetic\"}".utf8)
        let result=try await transport(s,store:store).send(requestBody:body,operationID:id);XCTAssertEqual(result.statusCode,401)
        let requests=AnonymousURLProtocol.captured();XCTAssertEqual(requests.count,3)
        XCTAssertEqual(requests[1].url?.path,"/auth/anonymous");XCTAssertEqual(requests[0].httpBody,requests[2].httpBody)
        XCTAssertEqual(requests[0].value(forHTTPHeaderField:"X-Automation-Operation-ID"),id.uuidString.lowercased())
        XCTAssertEqual(requests[2].value(forHTTPHeaderField:"X-Automation-Operation-ID"),id.uuidString.lowercased())
        XCTAssertNil(requests[0].value(forHTTPHeaderField:"X-Automation-Guest-Token"));XCTAssertNil(requests[1].value(forHTTPHeaderField:"Authorization"))
        XCTAssertNil(requests[1].value(forHTTPHeaderField:"X-Automation-Guest-Token"));XCTAssertNil(requests[1].value(forHTTPHeaderField:"X-Automation-Operation-ID"))
        XCTAssertEqual(requests[2].value(forHTTPHeaderField:"X-Automation-Guest-Token"),anonymousToken)
        let saved=await store.value;XCTAssertEqual(saved,anonymousRecord)
    }
    func testOrdinary401And404409429503NeverEnroll() async throws {
        let s=session();defer{s.invalidateAndCancel()}
        for status in [401,404,409,429,503] {
            let store=SyntheticAnonymousStore();AnonymousURLProtocol.reset([reply(status,"{\"error\":{\"code\":\"other\"}}")])
            let result=try await transport(s,store:store).send(requestBody:Data());XCTAssertEqual(result.statusCode,status);XCTAssertEqual(AnonymousURLProtocol.captured().count,1)
            let saves=await store.saves;XCTAssertEqual(saves,0)
        }
    }
    func testExistingAnonymous401DoesNotRotateIdentity() async throws {
        let s=session(),store=SyntheticAnonymousStore(anonymousRecord);defer{s.invalidateAndCancel()};AnonymousURLProtocol.reset([denied])
        let result=try await transport(s,store:store).send(requestBody:Data());XCTAssertEqual(result.statusCode,401);XCTAssertEqual(AnonymousURLProtocol.captured().count,1)
        let saves=await store.saves;XCTAssertEqual(saves,0)
    }
    func testExpiredOriginMismatchedMalformedAndStoreErrorsSendZeroRequests() async {
        let s=session();defer{s.invalidateAndCancel()}
        let values=[SecureAnonymousCredential(token:anonymousToken,expiresAt:anonymousNow,origin:anonymousRecord.origin),
                    SecureAnonymousCredential(token:anonymousToken,expiresAt:anonymousRecord.expiresAt,origin:"https://other.invalid:443"),
                    SecureAnonymousCredential(token:"bad",expiresAt:anonymousRecord.expiresAt,origin:anonymousRecord.origin)]
        for store in values.map({SyntheticAnonymousStore($0)}) + [SyntheticAnonymousStore(failRead:true)] {
            AnonymousURLProtocol.reset([]);do{_ = try await transport(s,store:store).send(requestBody:Data());XCTFail("Expected rejection")}catch{XCTAssertFalse(String(describing:error).contains(anonymousToken))}
            XCTAssertEqual(AnonymousURLProtocol.captured().count,0)
        }
    }
    func testAccountWinsWithoutReadingAnonymousAndHeadersNeverMix() async throws {
        let s=session(),store=SyntheticAnonymousStore(failRead:true);defer{s.invalidateAndCancel()};AnonymousURLProtocol.reset([reply(200)])
        let account=SecureAccountSession(appleUserID:"synthetic",accountID:"synthetic",token:anonymousToken)
        _ = try await transport(s,store:store,account:SyntheticAccountSource([account])).send(requestBody:Data())
        let reads=await store.reads;XCTAssertEqual(reads,0);let req=AnonymousURLProtocol.captured()[0]
        XCTAssertNotNil(req.value(forHTTPHeaderField:"Authorization"));XCTAssertNil(req.value(forHTTPHeaderField:"X-Automation-Guest-Token"))
    }
    func testAccountStoreFailureNeverFallsBackToGuest() async {
        let s=session();defer{s.invalidateAndCancel()};AnonymousURLProtocol.reset([])
        do{_ = try await transport(s,store:SyntheticAnonymousStore(),account:SyntheticAccountSource(fail:true)).send(requestBody:Data());XCTFail("Expected rejection")}catch{}
        XCTAssertEqual(AnonymousURLProtocol.captured().count,0)
    }
    func testAccountOrAnonymousAppearingDuringHandshakeStopsEnrollment() async {
        let s=session();defer{s.invalidateAndCancel()};let account=SecureAccountSession(appleUserID:"synthetic",accountID:"synthetic",token:anonymousToken)
        AnonymousURLProtocol.reset([denied]);do{_ = try await transport(s,store:SyntheticAnonymousStore(),account:SyntheticAccountSource([nil,account])).send(requestBody:Data());XCTFail("Expected rejection")}catch{}
        XCTAssertEqual(AnonymousURLProtocol.captured().count,1)
        AnonymousURLProtocol.reset([denied]);do{_ = try await transport(s,store:SyntheticAnonymousStore(appearAt:2)).send(requestBody:Data());XCTFail("Expected rejection")}catch{}
        XCTAssertEqual(AnonymousURLProtocol.captured().count,1)
    }
    func testSaveFailureOrChangedSavedCredentialPreventsReplay() async {
        let s=session();defer{s.invalidateAndCancel()}
        for store in [SyntheticAnonymousStore(failSave:true),SyntheticAnonymousStore(replaceAfterSave:true)] {
            AnonymousURLProtocol.reset([denied,issued()]);do{_ = try await transport(s,store:store).send(requestBody:Data());XCTFail("Expected rejection")}catch{}
            XCTAssertEqual(AnonymousURLProtocol.captured().count,2)
        }
    }
    func testMalformedExpiredUnexpectedEnrollmentResponseNeverSavesOrReplays() async {
        let s=session();defer{s.invalidateAndCancel()}
        for bad in [issued("bad"),issued(expiry:anonymousNow),reply(200,"{\"token\":\"\(anonymousToken)\"}"),reply(200,"{\"subject\":\"unexpected\"}"),reply(404)] {
            let store=SyntheticAnonymousStore();AnonymousURLProtocol.reset([denied,bad])
            do{_ = try await transport(s,store:store).send(requestBody:Data())}catch{}
            let saves=await store.saves;XCTAssertEqual(saves,0);XCTAssertEqual(AnonymousURLProtocol.captured().count,2)
        }
    }
    func testWrongResponseOriginOrInsecureTargetCannotEnroll() async {
        let s=session();defer{s.invalidateAndCancel()}
        var foreign=denied;foreign.url=URL(string:"https://other.invalid/plan")!;AnonymousURLProtocol.reset([foreign])
        do{_ = try await transport(s,store:SyntheticAnonymousStore()).send(requestBody:Data());XCTFail("Expected rejection")}catch{}
        XCTAssertEqual(AnonymousURLProtocol.captured().count,1)
        AnonymousURLProtocol.reset([]);do{_ = try await transport(s,store:SyntheticAnonymousStore(),url:URL(string:"http://plan.example.invalid/plan")!).send(requestBody:Data());XCTFail("Expected rejection")}catch{}
        XCTAssertEqual(AnonymousURLProtocol.captured().count,0)
    }
    func testTimeoutIsTypedAndDoesNotEnrollOrRetry() async {
        let s=session();defer{s.invalidateAndCancel()};AnonymousURLProtocol.reset([],failure:URLError(.timedOut))
        do{_ = try await transport(s,store:SyntheticAnonymousStore()).send(requestBody:Data());XCTFail("Expected timeout")}catch let error as URLError{XCTAssertEqual(error.code,.timedOut)}catch{XCTFail("Wrong error")}
        XCTAssertEqual(AnonymousURLProtocol.captured().count,1)
    }
    func testKeychainSeamsMissingCorruptDeniedAndPrivateAddNoOverwrite() async throws {
        let missing=KeychainAnonymousCredentialStore(service:"synthetic",read:{_,_ in errSecItemNotFound},add:{_,_ in errSecSuccess})
        let absent=try await missing.anonymousCredential();XCTAssertNil(absent)
        for status in [errSecInteractionNotAllowed,errSecDecode] {
            let store=KeychainAnonymousCredentialStore(service:"synthetic",read:{_,_ in status},add:{_,_ in errSecSuccess})
            do{_ = try await store.anonymousCredential();XCTFail("Expected error")}catch{}
        }
        let capture=SyntheticKeychainCapture()
        let store=KeychainAnonymousCredentialStore(service:"synthetic-anonymous",read:{_,_ in errSecItemNotFound},add:{q,_ in capture.save(q);return errSecSuccess})
        try await store.saveAnonymousCredential(anonymousRecord)
        XCTAssertEqual(capture.attributes[kSecAttrAccount as String] as? String,"anonymous-plan-credential")
        XCTAssertEqual(capture.attributes[kSecAttrAccessible as String] as? String,kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
        XCTAssertEqual(capture.attributes[kSecAttrSynchronizable as String] as? Bool,false)
        let data=try JSONEncoder().encode(anonymousRecord)
        let existing=KeychainAnonymousCredentialStore(service:"synthetic",read:{_,result in result?.pointee=data as CFData;return errSecSuccess},add:{_,_ in XCTFail("Must not replace");return errSecSuccess})
        let different=SecureAnonymousCredential(token:String(repeating:"B",count:42)+"A",expiresAt:anonymousRecord.expiresAt,origin:anonymousRecord.origin)
        do{try await existing.saveAnonymousCredential(different);XCTFail("Expected no rotation")}catch{}
        let corrupt=KeychainAnonymousCredentialStore(service:"synthetic",read:{_,result in result?.pointee=Data("bad".utf8) as CFData;return errSecSuccess},add:{_,_ in errSecSuccess})
        do{_ = try await corrupt.anonymousCredential();XCTFail("Expected corrupt rejection")}catch{}
    }
    func testActualHomeViewHTTPStatusMessagesAreSafeAndDistinct() {
        XCTAssertEqual(PlanHTTPStatusMessage.localized(401),"Kimlik doğrulanamadı; işlem başlatılamadı.")
        XCTAssertTrue(PlanHTTPStatusMessage.localized(409).contains("Otomatik tekrar gönderilmedi"))
        XCTAssertTrue(PlanHTTPStatusMessage.localized(429).contains("Günlük AI"))
        XCTAssertTrue(PlanHTTPStatusMessage.localized(503).contains("güvenli yetkilendirme"))
        XCTAssertEqual(Set([401,409,429,503].map(PlanHTTPStatusMessage.localized)).count,4)
    }
}
