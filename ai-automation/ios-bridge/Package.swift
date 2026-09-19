// swift-tools-version:5.9
//
// Mac'te 2026-09-18'de `swift build`/`swift test` ile derlendi ve
// doğrulandı (bkz. docs/ios-bridge.md §6, §8). `macOS` platformu, ürün
// yalnızca iOS'u hedeflese de burada gereklidir: `swift build`/`swift
// test` host olarak macOS'u derler, ve `BuilderMachine`'in kullandığı
// `ObservableObject`/`@Published` (Combine) macOS 10.15+ ister. Bu satır
// olmadan SwiftPM host derlemesi için çok eski bir varsayılan minimum
// kullanır ve derleme başarısız olur.

import PackageDescription

let package = Package(
    name: "AutomationCore",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "AutomationCore", targets: ["AutomationCore"]),
        .library(name: "AutomationUI", targets: ["AutomationUI"])
    ],
    targets: [
        .target(
            name: "AutomationCore",
            resources: [.copy("Resources/capability-registry-snapshot.json")]
        ),
        .testTarget(
            name: "AutomationCoreTests",
            dependencies: ["AutomationCore"],
            resources: [.copy("Fixtures/automation-plan-samples.json")]
        ),
        // Phase 4D-1: SwiftUI View/ViewModel katmanı — AutomationCore'dan
        // AYRI bir hedef, çünkü "core" mantık (state machine, registry,
        // HTTP client) platform sunumundan (SwiftUI) bağımsız kalmalı.
        // Gerçek bir App hedefi bu paketin dışında (App/) yaşar ve bu
        // ürünü tüketir.
        .target(name: "AutomationUI", dependencies: ["AutomationCore"]),
        // Phase 4E-2: BuilderViewModel'in displayDescription çevirisini
        // (capability id/description sızmadığını) doğrudan test etmek için.
        // AutomationCore da AYRICA listelenir — SwiftPM, AutomationUI'ın
        // KENDİ bağımlılığını (AutomationCore) test hedefine örtük
        // aktarmaz; MockPermissionService/BuilderMachine gibi tipler
        // için doğrudan `import AutomationCore` gerekiyor.
        .testTarget(name: "AutomationUITests", dependencies: ["AutomationUI", "AutomationCore"]),
    ]
)
