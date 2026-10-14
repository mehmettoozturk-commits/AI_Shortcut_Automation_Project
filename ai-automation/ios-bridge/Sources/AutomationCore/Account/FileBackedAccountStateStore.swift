import Foundation

/// Stores only the opaque Apple user ID and state, never an identity token,
/// authorization code, app session token, or other credential.
public actor FileBackedAccountStateStore: AccountStateStore {
    private let fileURL: URL

    public init(directory: URL, filename: String = "account-state.json") {
        self.fileURL = directory.appendingPathComponent(filename)
    }

    public func load() async -> AccountState {
        guard let data = try? Data(contentsOf: fileURL),
              let state = try? JSONDecoder().decode(AccountState.self, from: data)
        else { return .guest }
        return state
    }

    public func save(_ state: AccountState) async -> Bool {
        do {
            let data = try JSONEncoder().encode(state)
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true
            )
            try data.write(to: fileURL, options: .atomic)
            return true
        } catch {
            return false
        }
    }
}
