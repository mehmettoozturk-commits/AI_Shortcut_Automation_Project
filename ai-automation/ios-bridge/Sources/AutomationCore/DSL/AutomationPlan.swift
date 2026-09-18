// Automation DSL — src/dsl/schema.ts'in Swift karşılığı.
//
// JSON şekli TS tarafındaki zod şemasıyla BİREBİR aynı olmalı:
//   trigger: { type, device?, params? }
//   step:    { type: "ask_confirmation", message }
//          | { type: "conditional", condition, then: [step], else: [step] }
//          | { type: <capability id>, params? }
//
// Bu dosyanın doğruluğu contracts/automation-plan-samples.json'daki
// fixture'larla test edilir (DSLContractTests.swift) — ama bu testler
// Xcode'da çalıştırılmadı (bkz. Package.swift üst notu).

import Foundation

public struct TriggerDTO: Codable, Sendable, Equatable {
    public var type: String
    public var device: String?
    public var params: [String: AnyCodable]?

    public init(type: String, device: String? = nil, params: [String: AnyCodable]? = nil) {
        self.type = type
        self.device = device
        self.params = params
    }
}

/// WorkflowStep — src/dsl/schema.ts'teki WorkflowStepSchema union'ının
/// karşılığı. `indirect` kullanılıyor çünkü `.conditional` kendi
/// içinde WorkflowStepDTO dizileri barındırır (recursive union, aynı
/// TS tarafındaki `z.lazy` gibi).
public indirect enum WorkflowStepDTO: Sendable, Equatable {
    case askConfirmation(message: String)
    case conditional(condition: String, then: [WorkflowStepDTO], `else`: [WorkflowStepDTO])
    /// Bir capability action adımı. `type`, Capability Registry'deki
    /// bir id'ye karşılık gelir (örn. "tesla.sentry_mode.toggle").
    /// Bu dosya o id'lerin ne olduğunu BİLMEZ — id'ler yalnızca
    /// CapabilityRegistry.swift tarafından yorumlanır.
    case action(type: String, params: [String: AnyCodable]?)

    private enum CodingKeys: String, CodingKey {
        case type, message, condition, then, `else`, params
    }

    public var typeString: String {
        switch self {
        case .askConfirmation: return "ask_confirmation"
        case .conditional: return "conditional"
        case .action(let type, _): return type
        }
    }
}

extension WorkflowStepDTO: Decodable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "ask_confirmation":
            let message = try container.decode(String.self, forKey: .message)
            self = .askConfirmation(message: message)
        case "conditional":
            let condition = try container.decode(String.self, forKey: .condition)
            let then = try container.decode([WorkflowStepDTO].self, forKey: .then)
            let elseSteps = try container.decode([WorkflowStepDTO].self, forKey: .else)
            self = .conditional(condition: condition, then: then, else: elseSteps)
        default:
            let params = try container.decodeIfPresent([String: AnyCodable].self, forKey: .params)
            self = .action(type: type, params: params)
        }
    }
}

extension WorkflowStepDTO: Encodable {
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .askConfirmation(let message):
            try container.encode("ask_confirmation", forKey: .type)
            try container.encode(message, forKey: .message)
        case .conditional(let condition, let then, let elseSteps):
            try container.encode("conditional", forKey: .type)
            try container.encode(condition, forKey: .condition)
            try container.encode(then, forKey: .then)
            try container.encode(elseSteps, forKey: .else)
        case .action(let type, let params):
            try container.encode(type, forKey: .type)
            try container.encodeIfPresent(params, forKey: .params)
        }
    }
}

/// Doğrulanmış otomasyon planı — src/dsl/schema.ts AutomationPlanSchema.
/// Yalnızca Schema/Capability/Permission/Safety Validator zincirinden
/// geçmiş planlar bu tipte temsil edilmelidir (TS tarafında olduğu
/// gibi burada da validasyon yapılmaz; bu yalnızca VERİ TAŞIYICIDIR).
public struct AutomationPlanDTO: Codable, Sendable, Equatable {
    public var name: String
    public var trigger: TriggerDTO
    public var steps: [WorkflowStepDTO]

    public init(name: String, trigger: TriggerDTO, steps: [WorkflowStepDTO]) {
        self.name = name
        self.trigger = trigger
        self.steps = steps
    }
}

/// Plandaki her adımı (iç içe then/else dahil) düz bir listeye açar —
/// src/dsl/schema.ts flattenSteps() ile birebir aynı davranış.
public func flattenSteps(_ steps: [WorkflowStepDTO]) -> [WorkflowStepDTO] {
    var out: [WorkflowStepDTO] = []
    for step in steps {
        out.append(step)
        if case .conditional(_, let then, let elseSteps) = step {
            out.append(contentsOf: flattenSteps(then))
            out.append(contentsOf: flattenSteps(elseSteps))
        }
    }
    return out
}

/// JSON'daki keyfi `params`/`details` alanlarını taşımak için minimal
/// tip-silinmiş kutu. Yalnızca Codable geçişi içindir; iş mantığı bu
/// tipi doğrudan yorumlamamalı.
public struct AnyCodable: Codable, Sendable, Equatable {
    public let value: Sendable

    public init(_ value: Sendable) { self.value = value }

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let v = try? c.decode(Bool.self) { value = v; return }
        if let v = try? c.decode(Double.self) { value = v; return }
        if let v = try? c.decode(String.self) { value = v; return }
        if let v = try? c.decode([String: AnyCodable].self) { value = v; return }
        if let v = try? c.decode([AnyCodable].self) { value = v; return }
        if c.decodeNil() { value = Optional<String>.none as Sendable; return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Desteklenmeyen AnyCodable tipi")
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch value {
        case let v as Bool: try c.encode(v)
        case let v as Double: try c.encode(v)
        case let v as Int: try c.encode(v)
        case let v as String: try c.encode(v)
        case let v as [String: AnyCodable]: try c.encode(v)
        case let v as [AnyCodable]: try c.encode(v)
        default: try c.encodeNil()
        }
    }

    public static func == (lhs: AnyCodable, rhs: AnyCodable) -> Bool {
        // Basit karşılaştırma: JSON'a kodlayıp bayt eşitliği.
        (try? JSONEncoder().encode(lhs)) == (try? JSONEncoder().encode(rhs))
    }
}
