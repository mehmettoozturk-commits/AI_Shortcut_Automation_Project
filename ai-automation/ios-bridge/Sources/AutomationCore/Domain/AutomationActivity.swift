import Foundation

/// Provenance is explicit: a user report is never proof of native execution.
public enum ActivitySource: String, Codable, Sendable {
    case appObserved = "app_observed"
    case userReported = "user_reported"
}

public enum ActivityEventType: String, Codable, Sendable {
    case automationCreated = "automation_created"
    case setupHandoffOpened = "setup_handoff_opened"
    case setupUserConfirmed = "setup_user_confirmed"
    case testRequested = "test_requested"
    case testUserPassed = "test_user_passed"
    case testUserFailed = "test_user_failed"
    case lifecycleChanged = "lifecycle_changed"
    case revisionCreated = "revision_created"
}

/// `automationId` identifies the original lineage; `revisionId` identifies
/// the exact local record. Neither field is a Shortcuts execution identifier.
public struct AutomationActivity: Codable, Sendable, Identifiable, Equatable {
    public var id: String { eventId }
    public let eventId: String
    public let automationId: String
    public let revisionId: String
    public let eventType: ActivityEventType
    public let source: ActivitySource
    public let timestamp: Date

    public init(
        eventId: String, automationId: String, revisionId: String,
        eventType: ActivityEventType, source: ActivitySource, timestamp: Date
    ) {
        self.eventId = eventId
        self.automationId = automationId
        self.revisionId = revisionId
        self.eventType = eventType
        self.source = source
        self.timestamp = timestamp
    }
}

public protocol AutomationActivityStore: Sendable {
    func list() async -> [AutomationActivity]
    /// Idempotent by `eventId`; returns false only if persistence failed.
    func append(_ event: AutomationActivity) async -> Bool
}
