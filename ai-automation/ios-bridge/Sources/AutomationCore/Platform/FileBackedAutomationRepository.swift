// Gerçek AutomationRepository — Phase 3C-3.
//
// Repository'nin TEK görevi kalıcılık (persistence) — native Shortcuts
// kodu burada YOK (bu SetupService/ShortcutsHandoff'un işi, bkz.
// Platform/TemplateBackedSetupService.swift, Platform/ShortcutsHandoff.swift).
// Bu ayrım bilinçli: Repository → persistence, SetupService → Shortcuts.
// İleride bir Android portu gerekirse bu sınır aynı kalır.
//
// Basit bir JSON dosyası olarak saklanır (UserDefaults/CoreData/SwiftData
// değil) — Codable zaten var, minimum OS sürümü yükseltmesi gerekmiyor
// (SwiftData iOS 17+ ister, bu paket iOS 16'yı hedefliyor), ve test
// edilebilirliği kolay: farklı bir `fileURL` enjekte ederek "uygulama
// kapat/aç" senaryosu iki ayrı repository örneğiyle simüle edilebilir.

import Foundation

public actor FileBackedAutomationRepository: AutomationRepository {
    private let fileURL: URL
    private var cache: [Automation]?
    private var failure: AutomationStorageState?

    public init(fileURL: URL) {
        self.fileURL = fileURL
    }

    /// `~/Library/Application Support/<bundleId>/automations.json` gibi
    /// makul bir varsayılan konum için kolaylık kurucusu.
    public init(directory: URL, filename: String = "automations.json") {
        self.fileURL = directory.appendingPathComponent(filename)
    }

    public func list() async -> [Automation] {
        load() ?? []
    }

    public func storageState() async -> AutomationStorageState {
        _ = load()
        return failure ?? .ready
    }

    @discardableResult public func save(_ automation: Automation) async -> Bool {
        guard var items = load() else { return false }
        if let idx = items.firstIndex(where: { $0.id == automation.id }) {
            items[idx] = automation
        } else {
            items.insert(automation, at: 0)
        }
        return persist(items)
    }

    public func setActive(_ id: String, active: Bool) async -> Bool {
        guard var items = load() else { return false }
        guard items.contains(where: { $0.id == id }) else { return false }
        items = items.map { automation in
            guard automation.id == id else { return automation }
            var copy = automation
            copy.status = active ? .active : .paused
            return copy
        }
        return persist(items)
    }

    public func deleteLocalRecord(_ id: String) async -> Bool {
        guard let items = load(), items.contains(where: { $0.id == id }) else { return false }
        return persist(items.filter { $0.id != id })
    }

    // MARK: - dosya G/Ç

    private func load() -> [Automation]? {
        guard failure == nil else { return nil }
        if let cache { return cache }
        let data: Data
        do {
            data = try Data(contentsOf: fileURL)
        } catch {
            let cocoa = error as NSError
            if cocoa.domain == NSCocoaErrorDomain && cocoa.code == NSFileReadNoSuchFileError {
                cache = []
                return []
            }
            failure = .readError
            return nil
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let decoded = try? decoder.decode([Automation].self, from: data) else {
            failure = .corrupt
            return nil
        }
        cache = decoded
        return decoded
    }

    private func persist(_ items: [Automation]) -> Bool {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        do {
            let data = try encoder.encode(items)
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true
            )
            try data.write(to: fileURL, options: .atomic)
            cache = items
            return true
        } catch {
            return false
        }
    }
}
