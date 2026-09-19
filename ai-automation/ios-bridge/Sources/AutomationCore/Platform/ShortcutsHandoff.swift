// Shortcuts handoff — Phase 3C-2, Phase 3B'nin gerçek cihaz kanıtlarına
// göre YENİDEN yazıldı (2026-09-19). Bu dosyanın önceki hali Phase 3B'den
// ÖNCE, hiçbir gerçek cihaz testi olmadan yazılmıştı ve şimdi YANLIŞ
// olduğu kanıtlanmış varsayımlar içeriyordu — o varsayımlar burada
// bilerek SİLİNDİ, düzeltilmedi bırakılmadı:
//
//  - ESKİ VARSAYIM: "shortcuts://import-shortcut?url=..." bir .shortcut
//    dosyasını içe aktarır. GERÇEK (Test 1): yalnızca Apple/iCloud
//    tarafından İMZALANMIŞ içerik için — imzasız içerik "Importing
//    unsigned shortcut files is not supported" ile REDDEDİLİR.
//  - ESKİ VARSAYIM: doğru mekanizma import-shortcut URL şemasıdır.
//    GERÇEK (Test 1b): iCloud paylaşım linkleri (https://www.icloud.com/
//    shortcuts/<id>) İÇİNE SARILMAMALI — bu URL'in kendisi (Universal
//    Link olarak) doğrudan açılmalı. import-shortcut'a sarmak "file
//    isn't in the correct format" hatası verir (o sayfa HTML, ham dosya
//    değil).
//  - ESKİ VARSAYIM: x-callback-url (`x-success`/`x-cancel`) sonucu bize
//    bildirir. GERÇEK (Test 7): import-shortcut için bu callback'lerin
//    HİÇBİRİ tetiklenmedi (en azından imzasız-red senaryosunda).
//
// Bu üç bulgunun BİRLEŞİK sonucu: bu protokol yalnızca "URL'i açmayı
// DENEDİK ve OS bunu işleyebildi mi" sorusuna cevap verebilir —
// kullanıcının Shortcuts içinde ne yaptığına dair HİÇBİR bilgi taşıyamaz.
// Gerçek sonuç yalnızca BuilderMachine.confirmShortcutAdded()/
// reportInstallFailed() ile, kullanıcının kendi beyanından gelir.

import Foundation

/// Kullanıcıyı Apple'ın kendi Shortcuts arayüzüne aktarır.
///
/// `open(_:)`'ın dönüş değeri YALNIZCA şunu söyler: iOS bu URL şemasını
/// işleyebildi mi (örn. Shortcuts uygulaması kurulu mu, URL biçimi
/// geçerli mi). `true` KULLANICININ KESTİRMEYİ EKLEDİĞİ ANLAMINA GELMEZ;
/// `false` yalnızca "hand-off'un kendisi başarısız oldu" (gerçekten
/// bildiğimiz bir hata) anlamına gelir — bu ayrım BuilderMachine'in
/// `setup_failed`'ı ne zaman kullanabileceğini belirler (bkz.
/// docs/phase3b-validation-plan.md Test 7 SONUÇ).
public protocol ShortcutsHandoff: Sendable {
    func open(_ url: URL) async -> Bool
}

/// MOCK — hiçbir gerçek URL açmaz. Testlerde `succeeds` ile hem "OS
/// açtı" hem "hand-off başarısız oldu" (örn. Shortcuts kurulu değil)
/// yollarını simüle etmek için kullanılır.
public actor MockShortcutsHandoff: ShortcutsHandoff {
    private let succeeds: Bool
    public private(set) var openedURLs: [URL] = []

    public init(succeeds: Bool = true) {
        self.succeeds = succeeds
    }

    public func open(_ url: URL) async -> Bool {
        openedURLs.append(url)
        return succeeds
    }
}

#if canImport(UIKit)
import UIKit

/// GERÇEK implementasyon — Phase 3C-2. `UIApplication.shared.open`
/// yalnızca UIKit'in bulunduğu (gerçek iOS) hedeflerde derlenir; macOS
/// host'ta veya SwiftPM'in XCTest'inde (canlı bir UIApplication süreci
/// olmadığı için) ÇALIŞTIRILAMAZ — yalnızca gerçek cihaz/uygulama
/// derlemesinde (`xcodebuild ... -destination 'id=<gerçek iPhone>'`)
/// derlenip gerçek bir uygulama içinde çalıştırılabilir. Bu dosyanın bu
/// kısmı bu oturumda ÇALIŞTIRILMADI, yalnızca BUILD ile doğrulandı.
@MainActor
public struct UIKitShortcutsHandoff: ShortcutsHandoff {
    public init() {}

    public func open(_ url: URL) async -> Bool {
        await withCheckedContinuation { continuation in
            UIApplication.shared.open(url, options: [:]) { success in
                continuation.resume(returning: success)
            }
        }
    }
}
#endif
