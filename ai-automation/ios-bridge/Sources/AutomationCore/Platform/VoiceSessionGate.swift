import Foundation

/// Framework-free ownership gate shared by the native voice adapter and
/// deterministic tests. Permission waits and callbacks belong to one token.
@MainActor
public final class VoiceSessionGate {
    private var token: UUID?
    public private(set) var isStarting = false
    public init() {}

    public func authorize(permission: () async -> Bool) async -> UUID? {
        guard token == nil else { return nil }
        let candidate = UUID()
        token = candidate
        isStarting = true
        let granted = await permission()
        guard token == candidate else { return nil }
        isStarting = false
        guard granted else { token = nil; return nil }
        return candidate
    }

    public func accepts(_ candidate: UUID) -> Bool { token == candidate && !isStarting }
    public func stop() { token = nil; isStarting = false }
}
