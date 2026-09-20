// Phase 5B Test 5B-2 — Phase 5A Test 6'nın bulduğu gap'i ÖLÇER:
// `PlanHTTPTransport`'ta istemci tarafı özel bir zaman aşımı yok
// (bkz. PlanHTTPTransport.swift — `URLSessionPlanTransport`, `URLSession.shared`
// kullanır, `timeoutIntervalForRequest` override edilmiyor). Bu test
// GERÇEK bir `URLSessionPlanTransport` ile, GERÇEK ama kasıtlı olarak
// gecikmeli yanıt veren yerel bir HTTP sunucusuna karşı ölçüm yapar —
// sahte bir transport DEĞİL, çünkü asıl soru "URLSession'ın kendi
// varsayılan davranışı ne" (bunu bir test double taklit edemez).
//
// ÖNCE ÖLÇ, SONRA DÜZELT: bu test hiçbir davranışı DÜZELTMEZ, yalnızca
// mevcut (bug olabilecek) davranışı deterministik ve tekrarlanabilir
// şekilde belgeler. `swift test`'in rutin/hızlı koşusunu YAVAŞLATMAMAK
// için `RUN_SLOW_TESTS=1` olmadan atlanır (XCTSkip) — bkz.
// docs/phase5b-failure-matrix-plan.md Test 5B-2.
//
// Çalıştırmak için: bir gecikmeli sunucu başlat (bkz. plan dokümanı),
// sonra: RUN_SLOW_TESTS=1 swift test --filter HTTPBackedPlannerTimeoutTests

import XCTest
@testable import AutomationCore

final class HTTPBackedPlannerTimeoutTests: XCTestCase {
    func testSlowRealResponse_measuresActualClientBehavior() async throws {
        guard ProcessInfo.processInfo.environment["RUN_SLOW_TESTS"] == "1" else {
            throw XCTSkip("RUN_SLOW_TESTS=1 olmadan atlanır (bu test ~60-70sn sürer).")
        }
        guard let url = URL(string: "http://127.0.0.1:3999/plan") else {
            return XCTFail("geçersiz URL")
        }

        let transport = URLSessionPlanTransport(url: url)
        let permissions = MockPermissionService(granted: [])
        let planner = HTTPBackedPlanner(transport: transport, permissions: permissions)

        let start = Date()
        let result = await planner.plan(text: "Pil yüzde 20'ye düşünce bana haber ver", existingDraft: nil)
        let elapsed = Date().timeIntervalSince(start)

        print("Phase 5B Test 5B-2 ölçümü: elapsed=\(elapsed)s, result=\(result), lastError=\(String(describing: await planner.lastError))")

        // Bu assertion'lar bir DAVRANIŞ ZORUNLU KILMIYOR — yalnızca
        // testin gerçekten bir sonuca ulaştığını (sonsuz asılı
        // kalmadığını) doğruluyor. Gerçek bulgu konsol çıktısında ve
        // Test 5B-2 SONUÇ'ta.
        XCTAssertLessThan(elapsed, 90, "90 saniyeden uzun sürdü — sonsuz beklemeye yakın bir durum")
    }
}
