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

    public init(fileURL: URL) {
        self.fileURL = fileURL
    }

    /// `~/Library/Application Support/<bundleId>/automations.json` gibi
    /// makul bir varsayılan konum için kolaylık kurucusu.
    public init(directory: URL, filename: String = "automations.json") {
        self.fileURL = directory.appendingPathComponent(filename)
    }

    public func list() async -> [Automation] {
        load()
    }

    public func save(_ automation: Automation) async {
        var items = load()
        if let idx = items.firstIndex(where: { $0.id == automation.id }) {
            items[idx] = automation
        } else {
            items.insert(automation, at: 0)
        }
        persist(items)
    }

    public func setActive(_ id: String, active: Bool) async {
        var items = load()
        items = items.map { automation in
            guard automation.id == id else { return automation }
            var copy = automation
            copy.status = active ? .active : .paused
            return copy
        }
        persist(items)
    }

    // MARK: - dosya G/Ç

    private func load() -> [Automation] {
        if let cache { return cache }
        guard let data = try? Data(contentsOf: fileURL) else {
            cache = []
            return []
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let decoded = try? decoder.decode([Automation].self, from: data) else {
            cache = []
            return []
        }
        cache = decoded
        return decoded
    }

    private func persist(_ items: [Automation]) {
        cache = items
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(items) else { return }
        try? FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try? data.write(to: fileURL, options: .atomic)
    }
}
