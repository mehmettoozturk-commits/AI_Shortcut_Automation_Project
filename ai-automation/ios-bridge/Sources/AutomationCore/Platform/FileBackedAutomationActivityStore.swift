import Foundation

/// Separate sidecar keeps legacy `automations.json` untouched.
public actor FileBackedAutomationActivityStore: AutomationActivityStore {
    private let fileURL: URL

    public init(directory: URL, filename: String = "activity.json") {
        fileURL = directory.appendingPathComponent(filename)
    }

    public func list() async -> [AutomationActivity] {
        load() ?? []
    }

    public func append(_ event: AutomationActivity) async -> Bool {
        guard var events = load() else { return false }
        if events.contains(where: { $0.eventId == event.eventId }) { return true }
        events.insert(event, at: 0)
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(events)
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true
            )
            try data.write(to: fileURL, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    private func load() -> [AutomationActivity]? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return [] }
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode([AutomationActivity].self, from: data)
    }
}
