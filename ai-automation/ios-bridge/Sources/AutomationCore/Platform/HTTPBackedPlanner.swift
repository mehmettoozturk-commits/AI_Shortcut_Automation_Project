// Phase 4C — Swift → Backend → LLM'in ilk gerçek uçtan uca bağlantısı.
//
// KRİTİK MİMARİ SINIR: bu dosya şunları BİLMEZ —
//   ❌ HİÇBİR belirli platforma özel capability id'si (kaynak kodda
//      hiçbir yerde geçmez — bkz.
//      AutomationCoreTests/HTTPBackedPlannerTests.swift
//      "capability id hardcode edilmemiş" testi)
//   ❌ CapabilityRegistry (import bile etmez, registry'ye erişimi yok)
//   ❌ LLM'in kendisi (Claude, prompt, vs.)
// Yalnızca `PlanRequest` gönderir, `PlanResponse` JSON'unu decode eder.
// Platform kararlarının (bir eylem destekleniyor mu, hangi alternatifler
// var) SAHİBİ backend'de kalır (docs/api.md, docs/ios-bridge.md §Phase4C).
//
// `PlannerResult` (Ports.swift) normal plan, doğrulama nedeniyle bloke
// edilmiş plan ve anlaşılmamış giriş ayrımını taşır. "unsupported" durumu, TS
// tarafındaki `NluPlannerAdapter`nin yaptığı AYNI deseni tekrarlayarak
// ele alınır: backend'in ÇÖZDÜĞÜ (capability id'leri dahil) veriler
// sahte/minimal bir `DraftAutomationPlan`'a gömülüp `.plan(...)` olarak
// döndürülür — `BuilderMachine.submit()`'in KENDİ registry'si bunu
// otomatik olarak `.unsupported` BuilderStep'ine çevirir (Mocks.swift'te
// zaten test edilmiş, değişmeyen bir mekanizma). Böylece bu dosya
// capability id'lerin ANLAMINI hiç yorumlamadan, yalnızca TAŞIYARAK
// doğru sonucu üretir.
//
// Zengin HTTP hata ayrımı (400/422/502/timeout), `Planner` protokolünün
// dar sözleşmesini BOZMADAN, `lastError: PlannerError?` yan kanalından
// raporlanır (bkz. PlannerError.swift) — "Bir sorun oluştu"ya ezilmez.

import Foundation

/// `POST /plan` istek gövdesi — `src/api/contract.ts` PlanRequestSchema
/// ile birebir aynı alan adları.
private struct PlanRequestPayload: Encodable {
    let text: String
    let conversation: AnyCodable?
    let platform: String
    let grantedPermissions: [String]
}

private struct RawValidationIssue: Decodable {
    let code: String
    let path: String?
    let message: String
}

private struct RawValidationOutcome: Decodable {
    let ok: Bool
    let issues: [RawValidationIssue]
}

/// Gevşek/kısmi bir zarf: `PlanResponseSchema`'nın dört durumunun
/// TAMAMINI Swift'te ayrı bir discriminated union olarak MODELLEMEK
/// yerine, yalnızca bu dosyanın gerçekten okuduğu alanlar decode
/// edilir — bilinmeyen/kullanılmayan JSON alanları (örn. `intent`,
/// `band`) sessizce yok sayılır. Bu, `IntentResult`'ın (Entities dahil)
/// tüm karmaşıklığını Swift'e taşımadan (bu dosyanın hiç ihtiyacı yok)
/// dört durumu da TEK bir struct ile karşılamayı sağlar.
private struct RawPlanResponse: Decodable {
    let status: String
    let plan: DraftAutomationPlan?
    let validation: RawValidationOutcome?
    let capability: String?
    let trigger: String?
    let reason: String?
    let message: String?
    let conversation: AnyCodable?
}

private struct RawErrorBody: Decodable {
    let error: String
}

public actor HTTPBackedPlanner: Planner {
    private let transport: PlanHTTPTransport
    private let platform: String
    /// AYNI `PermissionService`'i BuilderMachine da kullanır — backend'in
    /// Permission Validator aşaması, Swift'in KENDİ bildiği izinlerle
    /// tutarlı çalışsın diye (bu olmadan her istek boş bir izin listesiyle
    /// gider ve gerçek bir backend'e karşı HER riskli/izinli eylem 422
    /// "missing_permission" ile döner — bu, ilk manuel uçtan uca smoke
    /// testte GERÇEK bir backend'e karşı çalıştırılarak keşfedildi).
    private let permissions: PermissionService

    /// Test ortamında / thread-safe erişimde konuşma durumunu saklar.
    private struct RequestTicket: Equatable { let generation: UUID; let id: UUID }
    private final class ConversationBox: @unchecked Sendable {
        private let lock = NSLock()
        private var _value: AnyCodable?
        private var generation = UUID()
        private var active: RequestTicket?
        private var pending: (body: Data, id: UUID)?
        private var task: Task<PlanHTTPResult, Error>?
        private var _error: PlannerError?
        init(value: AnyCodable? = nil) { self._value = value }
        var value: AnyCodable? {
            get { lock.lock(); defer { lock.unlock() }; return _value }
        }
        var error: PlannerError? { lock.lock(); defer { lock.unlock() }; return _error }
        func begin() -> RequestTicket? {
            lock.lock(); defer { lock.unlock() }; guard active == nil else { return nil }
            let ticket = RequestTicket(generation: generation, id: UUID()); active = ticket; _error = nil; return ticket
        }
        func current(_ ticket: RequestTicket) -> Bool { lock.lock(); defer { lock.unlock() }; return active == ticket && generation == ticket.generation }
        func operation(_ body: Data, ticket: RequestTicket) -> UUID? {
            lock.lock(); defer { lock.unlock() }; guard active == ticket && generation == ticket.generation else { return nil }
            if pending?.body != body { pending = (body, UUID()) }; return pending?.id
        }
        func register(_ task: Task<PlanHTTPResult, Error>, ticket: RequestTicket) {
            lock.lock(); let valid = active == ticket && generation == ticket.generation
            if valid { self.task = task }; lock.unlock(); if !valid { task.cancel() }
        }
        func accept(_ value: AnyCodable?, ticket: RequestTicket) -> Bool {
            lock.lock(); defer { lock.unlock() }; guard active == ticket && generation == ticket.generation else { return false }
            _value = value; pending = nil; return true
        }
        func setError(_ error: PlannerError, ticket: RequestTicket) {
            lock.lock(); defer { lock.unlock() }; guard active == ticket && generation == ticket.generation else { return }; _error = error
        }
        func end(_ ticket: RequestTicket) { lock.lock(); defer { lock.unlock() }; if active == ticket { active = nil; task = nil } }
        func invalidateInFlight(preserveAttempt: Bool) {
            lock.lock()
            let oldTask = task
            if !preserveAttempt { _value = nil; pending = nil }
            generation = UUID(); active = nil; task = nil; _error = nil
            lock.unlock()
            oldTask?.cancel()
        }
        func reset() { invalidateInFlight(preserveAttempt: false) }
    }

    private let conversationBox = ConversationBox()

    /// Backend DURUMSUZ (bkz. docs/api.md §2) — konuşma durumu istemcide
    /// tutulur. Bu alan `conversation` JSON'unu OPAK olarak taşır;
    /// `Entities`/`IntentResult`'ın Swift karşılığını yazmaya GEREK YOK
    /// çünkü bu sınıf onları hiç yorumlamaz, yalnızca aynen geri gönderir
    /// (backend'in `hydrate` ettiği TEK doğruluk kaynağı budur).
    private var conversation: AnyCodable? {
        get { conversationBox.value }
    }

    /// Son isteğin domain-level hatası (varsa) — `Planner` protokolünün
    /// dar `.notUnderstood`'una ek, gözlemlenebilir bir yan kanal.
    public var lastError: PlannerError? { conversationBox.error }

    public init(transport: PlanHTTPTransport, permissions: PermissionService, platform: Platform = .ios) {
        self.transport = transport
        self.permissions = permissions
        self.platform = platform.rawValue
    }

    /// Yeni bir konuşma başlatır — bağlam sıfırlanır (§ "Otomasyon
    /// Oluştur" akışından tamamen çıkış, BuilderMachine.close() gibi).
    /// Phase 5B P0: `Planner` protokol sözleşmesi gereği SENKRON ve
    /// thread-safe'tir (`nonisolated`).
    public nonisolated func resetConversation() {
        conversationBox.reset()
    }
    /// Superseding a UI submit must cancel its consumer without allocating a
    /// second operation for an identical uncertain request. Keep conversation
    /// and pending UUID; a changed body still receives a new operation UUID.
    public nonisolated func invalidateInFlightRequest() {
        conversationBox.invalidateInFlight(preserveAttempt: true)
    }

    public func plan(text: String, existingDraft: DraftAutomationPlan?) async -> PlannerResult {
        guard let ticket = conversationBox.begin() else { return .notUnderstood }
        defer { conversationBox.end(ticket) }
        let granted = await permissions.grantedPermissions()
        guard conversationBox.current(ticket) else { return .notUnderstood }
        let payload = PlanRequestPayload(
            text: text, conversation: conversation, platform: platform, grantedPermissions: granted
        )
        do {
            let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
            let body = try encoder.encode(payload)
            guard let operationID = conversationBox.operation(body, ticket: ticket) else { return .notUnderstood }
            let transport = self.transport
            let task = Task {
                if let bound = transport as? any OperationBoundPlanHTTPTransport {
                    return try await bound.send(requestBody: body, operationID: operationID)
                }
                return try await transport.send(requestBody: body)
            }
            conversationBox.register(task, ticket: ticket)
            let result = try await task.value
            guard conversationBox.current(ticket) else { return .notUnderstood }
            let interpreted = try interpret(result, ticket: ticket)
            return conversationBox.current(ticket) ? interpreted : .notUnderstood
        } catch let error as PlannerError {
            conversationBox.setError(error, ticket: ticket)
            return .notUnderstood
        } catch let error as URLError where error.code == .timedOut {
            conversationBox.setError(.requestTimedOut, ticket: ticket)
            return .notUnderstood
        } catch is CancellationError {
            return .notUnderstood
        } catch {
            conversationBox.setError(.plannerUnreachable(message: "Plan isteği tamamlanamadı."), ticket: ticket)
            return .notUnderstood
        }
    }

    // MARK: - HTTP durum kodu → domain sonucu

    /// Hata ayrımı (docs/api.md §8 Phase 4C eki):
    ///   200 (plan/needs_clarification/unsupported/not_understood) → başarı
    ///   422 → iyi biçimli ama Validation zincirinden geçemeyen plan
    ///   400 → istek gövdesi/şeması geçersiz
    ///   502 → LLM sağlayıcısı hiç çalışamadı (provider_error)
    ///   diğer her şey → plannerUnreachable
    private func interpret(_ result: PlanHTTPResult, ticket: RequestTicket) throws -> PlannerResult {
        switch result.statusCode {
        case 200, 422:
            let raw = try JSONDecoder().decode(RawPlanResponse.self, from: result.body)
            // Semantik tur BAŞARILI oldu (backend context'i güncelledi) —
            // 422'de bile konuşma durumu geçerli/güncel, yalnızca
            // ÇALIŞTIRILABİLİRLİK başarısız. Sıradaki turun aynı adımı
            // tekrarlamaması için her iki durumda da kaydedilir.
            if result.statusCode == 422 {
                let issues = raw.validation?.issues.map(\.message) ?? []
                guard raw.status == "plan", let draft = raw.plan,
                      let rawIssues = raw.validation?.issues, !rawIssues.isEmpty
                else { throw PlannerError.validationFailed(issues: issues) }
                guard conversationBox.accept(raw.conversation, ticket: ticket) else { throw CancellationError() }
                conversationBox.setError(.validationFailed(issues: issues), ticket: ticket)
                return .validationBlocked(draft, issues: rawIssues.map {
                    PlanValidationIssue(code: $0.code, path: $0.path, message: $0.message)
                })
            }
            guard conversationBox.accept(raw.conversation, ticket: ticket) else { throw CancellationError() }
            return mapSuccess(raw)
        case 400:
            let raw = try? JSONDecoder().decode(RawErrorBody.self, from: result.body)
            throw PlannerError.invalidRequest(message: raw?.error ?? "Geçersiz istek.")
        case 502:
            let raw = try? JSONDecoder().decode(RawPlanResponse.self, from: result.body)
            throw PlannerError.providerUnavailable(message: raw?.message ?? "Sağlayıcı şu anda kullanılamıyor.")
        default:
            throw PlannerError.serverUnavailable(status: result.statusCode)
        }
    }

    private func mapSuccess(_ raw: RawPlanResponse) -> PlannerResult {
        switch raw.status {
        case "plan":
            guard let plan = raw.plan else { return .notUnderstood }
            return .plan(plan)

        case "needs_clarification":
            // `conversation.currentPlan`, backend'in `plan-builder.ts`'te
            // ZATEN çözdüğü (capability id'leri dahil) TAM taslağı taşır
            // — `missing` alanı bekleyen soruyu içerir. BuilderMachine'in
            // KENDİ missing-info akışı (`advance()`/`nextMissingInfoQuestion`)
            // bunu `.understanding` sonrası doğal olarak sorar; TS
            // `NluPlannerAdapter`nin yaptığı ile birebir aynı desen.
            if let plan = extractCurrentPlan(from: raw.conversation) {
                return .plan(plan)
            }
            return .notUnderstood

        case "unsupported":
            // Backend'in ÇÖZDÜĞÜ (registry-farkında) capability id'lerini
            // sahte/minimal bir plana gömüyoruz — bu dosya onların ne
            // anlama geldiğini YORUMLAMAZ, yalnızca taşır.
            // `BuilderMachine.submit()`'in kendi registry kontrolü
            // (`findUnavailableCapability`) bunu doğru `.unsupported`
            // BuilderStep'ine çevirir. Trigger ÇÖZÜLEMEMİŞSE (backend
            // `trigger: null` verdi) anlamlı bir taslak kurulamaz — TS
            // `NluPlannerAdapter`nin aynı durumda yaptığı gibi
            // `.notUnderstood`'a düşülür.
            guard let capability = raw.capability, let trigger = raw.trigger else { return .notUnderstood }
            let draft = DraftAutomationPlan(
                name: raw.reason ?? "Desteklenmeyen işlem",
                trigger: TriggerDTO(type: trigger, device: nil),
                steps: [.action(type: capability, params: nil)]
            )
            return .plan(draft)

        default: // "not_understood" ve tanınmayan her durum
            return .notUnderstood
        }
    }

    /// `conversation` JSON'undan yalnızca `currentPlan` alt-alanını
    /// çıkarır — geri kalan (Entities/IntentResult) hiç modellenmez,
    /// çünkü bu sınıf onu hiç okumaz, yalnızca opak olarak taşır.
    private func extractCurrentPlan(from conversation: AnyCodable?) -> DraftAutomationPlan? {
        guard let dict = conversation?.value as? [String: AnyCodable],
              let currentPlanValue = dict["currentPlan"]
        else { return nil }
        guard let data = try? JSONEncoder().encode(currentPlanValue) else { return nil }
        return try? JSONDecoder().decode(DraftAutomationPlan.self, from: data)
    }
}
