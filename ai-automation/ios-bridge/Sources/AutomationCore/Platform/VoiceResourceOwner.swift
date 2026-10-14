import Foundation

/// Owns a single acquisition/cleanup pair, including partially acquired
/// resources. Native AVAudioEngine code and deterministic stubs share this.
@MainActor
public final class VoiceResourceOwner {
    private var cleanup: (() -> Void)?
    public init() {}

    public func start(acquire: () throws -> Void, release: @escaping () -> Void) throws {
        guard cleanup == nil else { throw OwnershipError.alreadyStarted }
        cleanup = release
        do { try acquire() }
        catch { stop(); throw error }
    }

    public func stop() {
        let release = cleanup
        cleanup = nil
        release?()
    }

    public enum OwnershipError: Error { case alreadyStarted }
}
