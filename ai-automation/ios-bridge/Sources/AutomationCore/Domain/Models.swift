// Domain models — src/domain/types.ts'in Swift karşılığı.
// Alan adları ve semantik TS tarafıyla birebir aynı tutulmuştur.
//
// ⚠️ Derlenmedi (bkz. Package.swift üst notu).

import Foundation

public enum Platform: String, Codable, Sendable {
    case ios
    case android
}

public struct User: Codable, Sendable, Identifiable {
    public var id: String
    public var createdAt: Date
    public var platform: Platform
    public var locale: String
    public var timezone: String

    public init(id: String, createdAt: Date, platform: Platform, locale: String, timezone: String) {
        self.id = id
        self.createdAt = createdAt
        self.platform = platform
        self.locale = locale
        self.timezone = timezone
    }
}

public enum AutomationStatus: String, Codable, Sendable {
    case draft
    case active
    case paused
    case archived
}

/// installStatus — docs/capabilities.md §1.2'nin doğrudan sonucu:
/// üçüncü taraf bir uygulamanın otomasyonu kendi başına kurduğunu
/// iddia etmesine dair kanıt yok. Bu yüzden "installed" durumuna
/// yalnızca kullanıcı "Ekledim" + "Bağladım" diye bildirdiğinde girilir
/// (bkz. Builder/). Bu, OS tetiklenmesinin bağımsız doğrulaması DEĞİLDİR;
/// UI bu durumu "Kurulum bildirildi" diye açıklar.
public enum InstallStatus: String, Codable, Sendable {
    case pendingUser = "pending_user"
    case installed
    case failed
}

/// Local setup checkpoint, not proof that iOS installed or ran anything.
/// Older records omit this field and resume from the safe setup entrance.
public enum SetupProgress: String, Codable, Sendable {
    case setup
    case importReady = "import_ready"
    case waitingForUser = "waiting_for_user"
    case linkingTrigger = "linking_trigger"
}

public struct Automation: Codable, Sendable, Identifiable {
    public var id: String
    public var userId: String
    public var name: String
    public var platform: Platform
    public var status: AutomationStatus
    public var trigger: TriggerDTO
    public var workflow: [WorkflowStepDTO]
    public var version: Int
    public var createdAt: Date
    public var updatedAt: Date
    public var requiresGuidedSetup: Bool
    public var installStatus: InstallStatus
    public var setupProgress: SetupProgress?
    /// A new local setup attempt derived from an older record. This does not
    /// mean an existing Shortcuts automation was edited or removed.
    public var sourceAutomationId: String?

    public init(
        id: String, userId: String, name: String, platform: Platform, status: AutomationStatus,
        trigger: TriggerDTO, workflow: [WorkflowStepDTO], version: Int,
        createdAt: Date, updatedAt: Date, requiresGuidedSetup: Bool, installStatus: InstallStatus,
        setupProgress: SetupProgress? = nil, sourceAutomationId: String? = nil
    ) {
        self.id = id
        self.userId = userId
        self.name = name
        self.platform = platform
        self.status = status
        self.trigger = trigger
        self.workflow = workflow
        self.version = version
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.requiresGuidedSetup = requiresGuidedSetup
        self.installStatus = installStatus
        self.setupProgress = setupProgress
        self.sourceAutomationId = sourceAutomationId
    }
}

public enum DeviceType: String, Codable, Sendable {
    case vehicle
    case phone
    case wearable
    case home
    case other
}

public struct Device: Codable, Sendable, Identifiable {
    public var id: String
    public var userId: String
    public var type: DeviceType
    public var name: String
    public var platformIdentifier: String

    public init(id: String, userId: String, type: DeviceType, name: String, platformIdentifier: String) {
        self.id = id
        self.userId = userId
        self.type = type
        self.name = name
        self.platformIdentifier = platformIdentifier
    }
}

public enum ExecutionStatus: String, Codable, Sendable {
    case pending
    case running
    case succeeded
    case failed
    case cancelledByUser = "cancelled_by_user"
}

public struct Execution: Codable, Sendable, Identifiable {
    public var id: String
    public var automationId: String
    public var startedAt: Date
    public var finishedAt: Date?
    public var status: ExecutionStatus
    public var errorCode: String?

    public init(
        id: String, automationId: String, startedAt: Date, finishedAt: Date? = nil,
        status: ExecutionStatus, errorCode: String? = nil
    ) {
        self.id = id
        self.automationId = automationId
        self.startedAt = startedAt
        self.finishedAt = finishedAt
        self.status = status
        self.errorCode = errorCode
    }
}
