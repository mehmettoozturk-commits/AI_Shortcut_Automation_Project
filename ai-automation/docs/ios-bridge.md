# iOS Bridge Preparation (Phase 3A)

## 0. En önemli cümle

**Güncelleme (2026-09-18, Mac, gerçek toolchain):** `ios-bridge/`
paketi artık gerçek Swift derleyicisiyle (`swift-driver` 1.148.6,
Apple Swift 6.3.3) derlendi ve test edildi — `swift build` ve
`swift test` PASS (16/16 test). Bunun için üç gerçek hata bulunup
düzeltildi (aşağıda §6'da işaretlenmiş):

1. `Package.swift`'te `platforms` listesinde yalnızca `.iOS(.v16)`
   vardı; `swift build`/`swift test` host olarak macOS'u derlediği
   için ve `BuilderMachine`'in `ObservableObject`/`@Published`
   (Combine) kullanımı macOS 10.15+ istediği için, `.macOS(.v13)`
   eklenmeden derleme "setter for 'step' is only available in macOS
   10.15 or newer" gibi ~30 hatayla başarısız oluyordu.
2. `CapabilityRegistryLoader.loadFromBundle(_ bundle: Bundle = .module)`
   — SwiftPM'in ürettiği `Bundle.module` erişimcisi `internal`
   olduğu için `public` bir fonksiyonun default argüman değeri olarak
   kullanılamıyordu. Parametresiz ayrı bir `public` overload'a
   bölündü.
3. `BuilderMachineTests.swift`'te iki yerde `XCTAssertEqual(await
   repo.list().count, 0)` — XCTest makrolarının autoclosure
   parametreleri içinde `await` desteklenmiyor. `await` çağrısı ayrı
   bir `let` satırına çıkarıldı.

Önceki durum (referans için): Bu paket daha önce hiçbir ortamda
derlenmemişti; kod yalnızca elle ve bir Python scriptiyle parantez
dengesi açısından kontrol edilmişti — tip kontrolü veya isim
çözümlemesi doğrulanmamıştı. Bu artık geçerli değil.

**Ek doğrulama (2026-09-18, aynı gün, gerçek cihaz — bir Phase 3B testi
DEĞİL, altyapı kontrolü):** Telefon (`ByTurco iPhone`, iPhone 16 Pro,
kablosuz eşleştirme, `devicectl` ile "available (paired)") ağdayken:

- `xcodebuild build -destination 'id=<gerçek cihaz>'` → **BUILD
  SUCCEEDED**, `arm64-apple-ios16.0` hedefiyle, iPhoneOS 26.5 SDK'sıyla.
  Yani kod yalnızca macOS host'ta değil, gerçek iOS mimarisi için de
  temiz derleniyor.
- `xcodebuild test -destination 'id=<gerçek cihaz>'` → **BAŞARISIZ**,
  ama kod hatası değil, Apple kısıtı: *"Cannot test target
  'AutomationCoreTests' on 'ByTurco iPhone': Tool-hosted testing is
  unavailable on device destinations. Select a host application for
  the test target, or use a simulator destination instead."* Çıplak bir
  SwiftPM test target'ı (host app'siz), fiziksel cihazda XCTest
  çalıştıramıyor — bunun için gerçek bir Xcode app hedefi (host
  application) gerekir. Bu, Phase 3B'de bir uygulama kabuğu
  yazıldığında otomatik çözülecek; şimdilik bilinçli olarak ele
  alınmadı.
- Bunun yerine `xcodebuild test -destination 'id=<iPhone 17 Simulator>'`
  → **TEST SUCCEEDED**, 16/16 test, gerçek iOS runtime'ında (macOS host
  değil). Simülatör olduğu için Bluetooth/CarPlay/Tesla'yı doğrulamaz
  (bkz. Phase 3B ön koşulları), ama Combine/Sendable/Bundle.module gibi
  platform-spesifik davranışların yalnızca macOS'a özgü bir yanılsama
  olmadığını gösterir.

**Phase 3B implementation round (2026-09-19):** P0 testleri (1, 1b, 2,
3, 5 — bkz. `docs/phase3b-validation-plan.md`) tamamlandıktan sonra
bulgular hem TS hem Swift koduna işlendi:

1. `BuilderStep`'e yeni bir `linkingTrigger` durumu eklendi (Test 2'nin
   kanıtladığı gerçek: otomasyon tetikleyicisi programatik bağlanamıyor,
   kullanıcı Otomasyon sekmesinde elle bağlamalı).
2. `installed`'a giren TEK yol artık iki ayrı onay:
   `confirmShortcutAdded()` ("Ekledim") + `confirmTriggerLinked()`
   ("Bağladım") — `userAssistedImport` akışında. `guided_manual`
   akışı ayrı kaldı: tek onay (`confirmGuidedSetupDone()`), çünkü
   kullanıcı zaten otomasyonun tamamını elle kuruyor.
3. `Capability`'ye `triggerLinkingSteps` eklendi — Test 2'de kaydedilen
   gerçek Bluetooth Otomasyon-sekmesi akışı buradan okunur, uydurulmaz.
4. `EvidenceLevel`'e `device_verified` eklendi (Apple dokümanından
   güçlü — gerçekten test edildiğini kanıtlar); `ios.bluetooth.disconnected`
   (Test 3) ve `tesla.sentry_mode.toggle` (Test 5) bu seviyeye
   yükseltildi; `PROGRAMMATIC_AUTOMATION_INSTALL.possible` artık
   `"unverified"` değil, gerçek cihaz kanıtıyla `false`.
5. TS: 185/185 test PASS (177 + 8 yeni). Swift: 20/20 test PASS
   (16 + 4 yeni), hem macOS host'ta hem gerçek iPhone hedefinde
   (`arm64-apple-ios16.0`) derleme PASS.

Bu değişiklikler `docs/ux.md` §3.6.d'nin tasarımını (2026-09-18'de
yazılmıştı) birebir koda döktü — isimlendirme (`confirmShortcutAdded`/
`confirmTriggerLinked`/`confirmGuidedSetupDone`) implementasyon
sırasında netleşti, ux.md güncellendi.

**Phase 3C-1 (2026-09-19) — Tesla parameter contract:** Test 5'in
kanıtladığı "parametre sabitlenmeli" kısıtı, `Capability.parameters`
(name/type/required/allowed/defaultValue) + `capability-validator.ts`
ile makine tarafından doğrulanan bir sözleşmeye çevrildi. Eksik/geçersiz
parametreli bir eylem artık reddediliyor. Swift yalnızca decode ediyor,
Tesla'nın şeması tekrar yazılmadı. TS: 193/193, Swift: 20/20.

**Phase 3C-2 (2026-09-19) — gerçek `SetupService`/`ShortcutsHandoff`
sınırı:** `Platform/ShortcutsHandoff.swift`, Phase 3B'den ÖNCE (hiçbir
cihaz testi olmadan) yazılmıştı ve artık YANLIŞ olduğu kanıtlanmış üç
varsayım içeriyordu — hepsi düzeltilmeden SİLİNDİ:

1. "import-shortcut imzasız içeriği de aktarır" → Test 1 bunu çürüttü.
2. "doğru mekanizma import-shortcut URL şemasıdır" → Test 1b: düz bir
   iCloud paylaşım linkini (Universal Link) açmak gerekiyor, sarmalamak
   DEĞİL.
3. "x-callback-url sonucu bize bildirir" → Test 7 bunun hiç
   tetiklenmediğini kanıtladı.

Yeni tasarım: `ShortcutsHandoff.open(_:) -> Bool` yalnızca "OS bu URL'i
işleyebildi mi" der, kullanıcının ne yaptığına dair HİÇBİR bilgi taşımaz
— gerçek implementasyon (`UIKitShortcutsHandoff`, `#if canImport(UIKit)`
arkasında) `UIApplication.shared.open` çağırır; yalnızca gerçek cihaz
BUILD'iyle doğrulandı (XCTest'te çalıştırılamaz, canlı UIApplication
yok). `SetupService.prepare()` artık `PrepareResult` (`.ready(url:,
name:)` / `.noTemplateAvailable(reason:)`) döner; gerçek implementasyon
`TemplateBackedSetupService`, registry'nin yeni `template` alanını
(Apple/iCloud şablon linki) okur.

**İÇERİK BOŞLUĞU (kod eksikliği DEĞİL):** 2026-09-19 itibarıyla
registry'deki 15 capability'nin HİÇBİRİNDE gerçek bir `template` yok —
birinin Shortcuts uygulamasında her eylem için elle bir şablon
oluşturup iCloud bağlantısını registry'ye eklemesi gerekiyor. O yapılana
kadar `TemplateBackedSetupService` HER plan için dürüstçe
`.noTemplateAvailable` döner. `BuilderMachine`'e `pendingHandoff` (private,
TS'deki `BuilderStep`'in şeklini bozmamak için state'in DIŞINDA tutulan
bir alan) ve yeni bir `shortcutsHandoff` bağımlılığı eklendi;
`handOffToShortcuts()` artık `async` ve OS açamazsa (gerçekten bilinen
bir hata) `setup_failed` üretir. TS: 193/193 (değişmedi — bu Swift/iOS'a
özgü bir iş). Swift: 26/26 (20 + 6 yeni), gerçek iPhone hedefinde BUILD
SUCCEEDED.

**Phase 3C-3 (2026-09-19) — gerçek `AutomationRepository`:**
`FileBackedAutomationRepository` (Swift, JSON dosyası — SwiftData/
CoreData değil, minimum iOS sürümünü yükseltmemek için) eklendi.
Repository'nin TEK görevi persistence; native Shortcuts kodu içinde
YOK (`SetupService`/`ShortcutsHandoff`'ta kalıyor) — bu ayrım ileride
bir Android portu için sınırı korur.

Davranış değişikliği (TS + Swift, ikisinde de, state machine tutarlılığı
için): `create()` artık `installStatus: pending_user` ile ERKEN bir
kayıt oluşturup kaydediyor; bu kaydın id'si akış boyunca taşınıp
(`currentAutomationId`/`pendingHandoff` ile aynı private-state paterni)
her geçişte GÜNCELLENİYOR (upsert) — çoğaltılmıyor:

- "Ekledim"/"Bağlayamadım" gibi ara adımlar → `pending_user` kalır.
- `reportInstallFailed()` (Ekleyemedim/Bağlayamadım, Swift'te ayrıca OS
  URL'i açamazsa) → `failed`.
- `.noTemplateAvailable` (içerik eksikliği, KESİN başarısızlık DEĞİL) →
  `pending_user` kalır, `failed` OLMAZ.
- `retrySetup()` → `failed`'i yeniden `pending_user`'a döndürür.
- `confirmTriggerLinked()`/`confirmGuidedSetupDone()` → TEK yol,
  `installed`.

Bunun için `InMemoryAutomationRepository.save()` (TS + Swift) gerçek
bir UPSERT'e düzeltildi — eskiden yalnızca prepend yapıyordu (aynı id
iki kez save() edilirse iki satır oluşurdu); artık `create()` erken
kayıt oluşturduğu için bu düzeltme zorunluydu.

TS: 201/201 (193 + 8 yeni). Swift: 33/33 (26 + 7 yeni), gerçek iPhone
hedefinde BUILD SUCCEEDED. `FileBackedAutomationRepositoryTests.swift`
(6/6), Test 8'in "uygulamayı kapat/aç" senaryosunu doğrudan kanıtlıyor:
aynı dosyaya işaret eden YENİ bir repository örneği önceki durumu
doğru koruyor.

## 1. Neden iki fazlı (3A / 3B)

Faz 1.5 ve Faz 2'de kurduğumuz disiplin — bir şeyi doğrulamadan
varsaymamak — Swift tarafında da geçerli olmalı. Bu ortamda Apple
framework'lerine karşı derleme yapamadığımdan, "yazdım ve çalışıyor"
diyemem. Bunun yerine:

- **Phase 3A (bu doküman):** platform sözleşmesi, Swift domain
  modelleri, state machine portu, mock adaptörler — hepsi TS tarafıyla
  tutarlılığı test edilebilir, ama gerçek iOS API'lerine dokunmaz.
- **Phase 3B:** Xcode'da gerçek derleme, gerçek `import AppIntents`,
  gerçek Bluetooth/CarPlay/Shortcuts entegrasyonu, gerçek cihaz testi.

## 2. Kurulan yapı

```
ios-bridge/
├── Package.swift
├── Sources/AutomationCore/
│   ├── Domain/Models.swift              → src/domain/types.ts karşılığı
│   ├── DSL/AutomationPlan.swift         → src/dsl/schema.ts karşılığı (özel Codable)
│   ├── CapabilityRegistry/
│   │   ├── Capability.swift             → src/capability-registry/types.ts
│   │   └── CapabilityRegistryLoader.swift → JSON snapshot yükleyici + resolver
│   ├── Builder/
│   │   ├── BuilderStep.swift            → src/builder/types.ts (yeni kurulum modeli dahil)
│   │   ├── Ports.swift                  → src/builder/ports.ts
│   │   ├── BuilderMachine.swift         → src/builder/machine.ts TAM PORTU
│   │   └── Mocks.swift                  → src/builder/mocks.ts
│   ├── Platform/
│   │   ├── AppIntentDraft.swift         → App Intent protokol taslağı
│   │   ├── ShortcutsHandoff.swift       → Shortcuts handoff abstraction
│   │   └── PermissionAdapter.swift      → izin abstraction'ı
│   └── Resources/
│       └── capability-registry-snapshot.json  ← contracts/generate.mjs çıktısı
└── Tests/AutomationCoreTests/
    ├── DSLContractTests.swift           → gerçek TS fixture'larını decode eder
    ├── BuilderMachineTests.swift        → machine.ts'in 101 testinin Swift karşılığı
    └── Fixtures/automation-plan-samples.json
```

## 3. TS ↔ Swift sözleşmesi nasıl kanıtlanıyor

`contracts/generate.mjs` — **bu script gerçekten çalıştırıldı** (Node
ile, `npx tsx contracts/generate.mjs`). Üç örnek planı **gerçek
`AutomationPlanSchema` (zod)** ile doğruluyor ve `CAPABILITIES`
registry'sini olduğu gibi JSON'a döküyor. Çıktı:

```
OK: 3 plan doğrulandı, 15 capability dışa aktarıldı.
```

Bu iki önemli şeyi kanıtlıyor:
1. Swift'in decode etmesi beklenen JSON, gerçekten TS şemasından geçmiş.
2. **Capability verisi Swift'te tekrar yazılmadı.** `CapabilityRegistry.
   swift`, bu JSON'u bundle'dan okuyor. İki dilde iki ayrı liste tutmak,
   Phase 1.5'in "tek doğruluk kaynağı" ilkesini bozardı.

`DSLContractTests.swift` bu fixture'ları decode edip TS tarafındaki
şekille eşleştiğini iddia ediyor — **2026-09-18'de Mac'te `swift test`
ile gerçekten çalıştırıldı ve PASS oldu** (bkz. §0).

## 4. Builder state machine portu — neye dikkat edildi

`BuilderMachine.swift`, `machine.ts`'in birebir çevirisidir. Özellikle
korunan değişmezler:

- **Güncellendi (Phase 3B Test 2, 2026-09-19):** `installed`/`success`'e
  girmenin tek yolu artık TEK bir onay değil — `userAssistedImport`
  akışında iki ayrı gerçek kullanıcı onayı gerekir: `confirmShortcutAdded()`
  ("Ekledim") ve ardından `confirmTriggerLinked()` ("Bağladım").
  `guided_manual` akışında ayrı bir trigger-linking adımı yok, tek onay
  (`confirmGuidedSetupDone()`) yeterli — çünkü kullanıcı otomasyonun
  TAMAMINI zaten elle kurmuş oluyor. `create()`, `prepareHandoff()`,
  `handOffToShortcuts()` — hiçbiri otomasyonu kaydetmez.
- `waitingForUser`'dan VE yeni `linkingTrigger`'dan otomatik ilerleme
  yok (zamanlayıcı/varsayım yok, ikisinde de).
- Kurulum yöntemi (`resolveSetupKind`) yalnızca registry'den okunur;
  `automatic` hiçbir yerde üretilmez — zaten `CapabilityRegistry.init`
  böyle bir satırı bulursa fırlatır (`assertNoUnprovenAutomaticInstall`).
- Üç seviyeli araç çözümlemesi (`CapabilityResolver.resolveTrigger`)
  CarPlay → Bluetooth → Konum sırasını TS resolver'ıyla aynı şekilde
  uyguluyor.

`BuilderMachineTests.swift` bu değişmezleri XCTest olarak ifade ediyor —
Mac'te `swift test` ile çalıştırıldı, PASS. Phase 3B Test 2'den sonra
eklenen `linkingTrigger`/Ekledim+Bağladım invariant'ları için yeni
testler de dahil (2026-09-19), toplam 20/20 PASS (bkz. §0).

## 5. App Intent / Shortcuts — doğrulanan ve doğrulanmayan

### Doğrulanan (Apple'ın resmi AppIntents dokümantasyonu, 2026-09-18)

```swift
protocol AppIntent: PersistentlyIdentifiable, Sendable {
    static var title: LocalizedStringResource { get }
    func perform() async throws -> some IntentResult
}
```
`@Parameter` property wrapper ile girdi parametreleri işaretlenir;
Siri/Shortcuts'a görünürlük `AppShortcutsProvider` + `@AppShortcutsBuilder`
ile ayrıca sağlanır.

`AppIntentDraft.swift` bu şekli bir taslak protokol olarak yansıtıyor —
gerçek `import AppIntents` YOK, çünkü framework'e karşı derlenemiyoruz
ve yanlış bir API yüzeyi varsaymak istemiyoruz. Phase 3B'de bu dosya
gerçek framework importuyla değiştirilecek.

**Önemli ayrım:** bizim senaryomuzda (Tesla Sentry Mode) kendi App
Intent'imizi tanımlamıyoruz — Tesla'nın kendi resmi Shortcuts eylemini
çağırıyoruz. Bu iki şey karıştırılmamalı; `ExternalAppIntentInvoker`
protokolü bunun için ayrı tutuldu.

### Doğrulanan (support.apple.com, x-callback-url)

`shortcuts://x-callback-url/run-shortcut?...&x-success=...` bir
shortcut'ı çalıştırır ve `x-success`/`x-cancel`/`x-error` ile sonucu
çağıran uygulamaya bildirir.

### Doğrulanmayan — "candidate mechanism" olarak işaretlendi

**Bu bölüm 2026-09-18'de revize edildi: aşağıdaki mekanizmaların hiçbiri
kanıtlanmış değil ve MVP'nin "tek dokunuş" iddiası GERİ ÇEKİLDİ.**
Kullanıcıya tek dokunuşluk bir kurulum vaat edip gerçekte olmayan bir
şeyi olmuş gibi göstermek, tam olarak MASTER_SPEC §18'in yasakladığı
şey. Bu yüzden üç ayrı iddia birbirinden ayrıştırılıp her biri açıkça
**doğrulanmamış** (candidate mechanism) olarak işaretlendi:

| # | İddia | Durum | Kanıt |
|---|---|---|---|
| A | `shortcuts://import-shortcut?url=...` (veya düz bir iCloud paylaşım linki) bir `.shortcut` eylem dizisini içe aktarır | **KISMEN DOĞRULANDI, KISMEN REDDEDİLDİ (gerçek cihaz, 2026-09-18)** | İki alt-sonuç: (1) **imzasız/AI-üretimi içerik → RED** — "Importing unsigned shortcut files is not supported" (Test 1). (2) **Apple/iCloud imzalı, önceden elle hazırlanmış şablon → KABUL** — düz iCloud paylaşım linki (`shortcuts://import-shortcut` sarmalayıcısı olmadan, Universal Link ile) Safari üzerinden açıldığında içe aktarma, ekleme ve çalıştırma başarılı (Test 1b). Bkz. `docs/phase3b-validation-plan.md` Test 1 / Test 1b SONUÇ. |
| B | İçe aktarılan bir shortcut, programatik olarak bir Personal Automation tetikleyicisine (Bluetooth/CarPlay) bağlanabilir | **candidate, muhtemelen HAYIR** | hiçbir kaynakta böyle bir mekanizma bulunamadı |
| C | Bluetooth/CarPlay tetikleyicisi kullanıcı müdahalesi olmadan kurulabilir | **candidate, muhtemelen HAYIR** | Personal Automation kurulumu tarihsel olarak yalnızca Shortcuts uygulamasının kendi arayüzünden yapılabiliyor |

Bu üçü **ayrı ayrı** test edilmeden (bkz. `docs/phase3b-validation-plan.md`
Test 1-2) hiçbiri doğru kabul edilmemeli. A doğru çıkıp B/C yanlış
çıkarsa bile ürün çökmez — bu durumda akış şu şekilde tasarlanır:

```
Kestirmeyi Hazırla  →  Kestirmelere Ekle  →  Otomasyon Tetikleyicisini Bağla
   (paket derlenir)     (A doğrulanırsa,       (kullanıcı Shortcuts'ın
                          eylem aktarılır)       Otomasyon sekmesinde
                                                  tetikleyiciyi kendisi
                                                  seçer — ekstra bir adım)
```

Yani `docs/ux.md` §3.6.b'deki `user_assisted_import` state'i tek bir
"Kestirmelere Ekle" dokunuşuyla bitebileceği gibi, B/C doğrulanmazsa
**üç adımlı** bir akışa çıkabilir. Builder state machine bu ek adımı
karşılayacak şekilde genişletilebilir (`waitingForUser` sonrası yeni bir
`linkingTrigger` state'i) — ama bu, hangi mekanizmanın gerçekten
çalıştığı netleşmeden KODLANMAYACAK (erken/spekülatif state eklemek,
Phase 1.5'in "varsaymadan kodlama" ilkesini ihlal eder).

**Kesin olan tek şey:** hiçbir ekran, hiçbir kopya metni "tek
dokunuşla kurulur" diye vaat etmemeli, ta ki A/B/C gerçek cihazda
doğrulanana kadar.

## 6. Swift dilinde risk taşıyan noktalar (Mac'te `swift build`/`swift test` ile doğrulandı — 2026-09-18)

1. `AnyCodable.value: Sendable` — existential `Sendable` depolama.
   **Çözüldü/risksiz çıktı:** `swift build` bunu tools-version 5.9,
   varsayılan (minimal) concurrency checking altında sorunsuz derledi,
   hiçbir Sendable uyarısı vermedi.
2. `CapabilityRegistry: @unchecked Sendable` — bilerek otomatik
   sentezleme yerine açık `@unchecked` kullanıldı. **Derleme açısından
   risksiz çıktı** (derleyici hata/uyarı vermedi); gerçek thread-safety
   yine de çalışma zamanında doğrulanmadı, bu satır bilgi amaçlı kalıyor.
3. `Bundle.module` kullanımı — **gerçek hata çıktı ve düzeltildi**:
   `CapabilityRegistryLoader.loadFromBundle(_ bundle: Bundle = .module)`
   içindeki default değer, üretilen `Bundle.module` erişimcisi
   `internal` olduğu için `public` fonksiyonda derlenmiyordu (bkz. §0).
   Parametresiz `public static func loadFromBundle() throws -> ...`
   overload'ına bölünerek çözüldü.
4. `WorkflowStepDTO`'nun `indirect enum` + otomatik `Equatable` sentezi
   — **risksiz çıktı**, `swift build`/`swift test` sorunsuz derledi ve
   `DSLContractTests` (round-trip/flatten testleri dahil) PASS.
5. **Yeni bulunan risk (dokümanda önceden yoktu):** `Package.swift`'te
   yalnızca `.iOS(.v16)` platformu vardı; `swift build`/`swift test`
   host olarak macOS'u derlediği için ve `BuilderMachine`'in
   `ObservableObject`/`@Published` kullanımı macOS 10.15+ istediği
   için, `.macOS(.v13)` eklenmeden ~30 "setter for 'step' is only
   available in macOS 10.15 or newer" hatası alınıyordu. Bir SwiftPM
   paketi yalnızca iOS'u hedeflese bile, host'ta `swift test`
   çalıştırılacaksa `platforms` listesine uygun bir `.macOS(...)`
   girişi eklenmesi gerekiyor.
6. **Yeni bulunan risk:** `BuilderMachineTests.swift`'te
   `XCTAssertEqual(await repo.list().count, 0)` gibi çağrılar —
   XCTest assertion makrolarının autoclosure parametreleri içinde
   `await` desteklenmiyor ("'async' call in an autoclosure that does
   not support concurrency"). `await` sonucu önce bir `let`'e alınıp
   sonra assert edilmeli.

## 7. Kapsam dışı (bilerek yapılmadı)

- Gerçek `import AppIntents`, `import CoreBluetooth`,
  `import CoreLocation`, `import Shortcuts` çağrıları.
- Tesla API/OAuth entegrasyonu.
- SwiftUI View'lar (bu, BuilderMachine `ObservableObject` olarak
  hazırlandığı için Phase 3B'de View katmanı eklemeye hazır, ama View
  kodu henüz yazılmadı).
- Üretim kimlik bilgileri.
- Gerçek cihaz/simülatör testi.

## 8. Phase 3B kontrol listesi

Sistematik test planı artık ayrı bir dokümanda:
**`docs/phase3b-validation-plan.md`** — 8 test, P0/P1 önceliklendirmeli,
her biri geçti/kaldı kriterleriyle. Bu bölüm yalnızca kod tarafındaki
hazırlık maddelerini listeler:

1. `swift build` ve `swift test` çalıştır; §6'daki risk noktalarını çöz.
2. Validation plan Test 1-2 (Shortcut import + Personal Automation
   bağlama) sonucuna göre `docs/ux.md` §3.6.b'yi ve gerekirse
   `BuilderStep`'i (Swift + TS) güncelle.
3. NLU bağlantısı artık KARARLANDI (bkz. bu konuşmanın "NLU → Swift
   bağlantısı" kararı): Swift `Planner` protokolünün gerçek
   implementasyonu, TS backend'e HTTPS/JSON ile bağlanan bir HTTP
   client olacak. `MockPlanner`'ın yerini bu alacak; NLU mantığının
   hiçbir parçası Swift'e taşınmayacak. API sözleşmesi:
   `docs/phase3b-validation-plan.md` §"Planner API sözleşmesi".
4. iOS 16/17/18 Bluetooth/Wi-Fi/Mesaj davranış boşluğunu
   (docs/capabilities.md §5.1) gerçek cihazlarda doldur.
5. `AppIntentDraft.swift`'i gerçek `import AppIntents` ile değiştir.

## 9. İlk gerçek MVP senaryosu (değişmedi, ama dokunuş sayısı garantisi yok)

"Arabadan ayrılınca Tesla Sentry Mode'u aç" — NLU → Entity → Capability
Registry → Validation zinciri → AI Builder onayı → Kullanıcı onayı →
Shortcuts handoff → kullanıcı Apple arayüzünde onaylar → `installed`.

Bu senaryo gerçek cihazda çalıştığında sistemin çekirdeği kanıtlanmış
olur. Ama §5'teki A/B/C candidate mechanism'ları netleşmeden, bunun
**tek dokunuşta mı yoksa "Kestirmeyi Hazırla → Kestirmelere Ekle →
Otomasyon Tetikleyicisini Bağla" üç adımında mı** biteceği kesin
değildir. `docs/phase3b-validation-plan.md` bu belirsizliği gerçek
cihazda kapatacak ilk çalışmadır.

## 10. NLU → Swift bağlantısı (KARARLANDI)

```
SwiftUI Application
        │
        ▼
Builder ViewModel (BuilderMachine, zaten yazıldı — Sources/AutomationCore/Builder/)
        │
        ▼
Planner protocol (zaten yazıldı — Ports.swift)
        │
        │  HTTPS / JSON  ← Phase 3B'de yazılacak TEK yeni parça:
        │                   HTTPBackedPlanner: Planner
        ▼
TS Backend (Phase 2 NLU boru hattı — DEĞİŞMEDEN, olduğu gibi kullanılır)
        │
        ▼
Draft Plan → Schema → Capability → Permission → Safety (zaten var)
        │
        ▼
JSON → Swift → Native iOS Adapter
```

**Karar:** NLU mantığının HİÇBİR parçası Swift'e taşınmayacak.
`Planner` protokolü (Ports.swift) zaten soyut; Phase 3B'de yazılacak
tek yeni Swift türü `HTTPBackedPlanner: Planner` olacak — TS backend'e
`POST /plan` ile bağlanan ince bir HTTP client. `MockPlanner`
(Mocks.swift) yalnızca önizleme/test için kalır.

Bunun avantajı: NLU sağlayıcısı (deterministik kural tabanlı → OpenAI →
başka bir LLM → kendi modelimiz) değiştiğinde iPhone uygulaması hiç
dokunulmadan çalışmaya devam eder.

### Platforma özel id sızıntısı yasağı (KARARLANDI, testle kilitlendi)

AI/NLU katmanı **hiçbir zaman** `"ios.bluetooth.disconnected"` gibi
platforma özel bir capability id üretmez — yalnızca semantik isimler
üretir (`"vehicle_departure"`, `"vehicle_sentry_mode"`). Bu, Phase 2'de
zaten böyle tasarlanmıştı (`src/nlu/types.ts`: `SemanticTrigger`,
`SemanticStep`); bu konuşmada eksik olan tek şey bunu ÇALIŞMA ZAMANINDA
kilitleyen bir testti — artık var:
`tests/nlu-semantic-only.test.ts` (19 test, 9 farklı girdi × trigger/step
kontrolü), 177 testin bir parçası olarak yeşil.

Bu, ürünün iOS + Android + Home Assistant + başka servislere
genişleyebilmesinin temel taşıdır: backend registry semantik ismi
platforma özel id'ye çözer, AI hiçbir platforma özel kelime öğrenmez.

### Planner API sözleşmesi (Phase 3B'de implemente edilecek, burada yalnızca tanımlı)

```
POST /plan
Request:  { "text": string, "context": ConversationContext | null }
Response: PlanningOutcome  (src/nlu/types.ts'teki şekil, JSON olarak)

POST /plan/answer
Request:  { "answer": string, "context": ConversationContext }
Response: PlanningOutcome
```

`ConversationContext` ve `PlanningOutcome` TS tarafında zaten tanımlı
(`src/nlu/types.ts`); Swift tarafında bunların Codable karşılıkları
Phase 3B'de `HTTPBackedPlanner` ile birlikte yazılacak — bu Phase 3A'nın
kapsamına alınmadı çünkü NLU bağlantı kararı bu konuşmada netleşti,
Phase 3A'nın yazıldığı sırada değil.

## Phase 4C — `HTTPBackedPlanner`: ilk gerçek uçtan uca bağlantı (2026-09-19)

Yukarıdaki bölümün planladığı `HTTPBackedPlanner: Planner` artık gerçek
— `Sources/AutomationCore/Platform/HTTPBackedPlanner.swift` (+
`PlanHTTPTransport.swift`, `PlannerError.swift`). Kasıtlı olarak DAR
kapsam: **Shortcuts kurulumu/`installed`/gerçek execution YOK** — yalnızca
`Swift → HTTP → Backend (Phase 4B'nin `planAsync`'i) → semantik plan →
Swift preview (`.understanding`)` dikey dilimi.

### 1. `HTTPBackedPlanner` neyi bilmez

Bu dosya hiçbir platforma özel capability id'sini (`"tesla...".`/`"ios...".`
gibi) veya `CapabilityRegistry`'yi hiç import etmez/bilmez — bu, kaynak
kod taramasıyla kilitli (`HTTPBackedPlannerTests.testNoCapabilityIdHardcoded`,
`tests/nlu-contract.test.ts`'teki TS tarafı taramasının Swift karşılığı).
Yalnızca `PlanRequest` JSON'u gönderir, `PlanResponse` JSON'unu decode
eder. Backend'in ÇÖZDÜĞÜ capability id'leri (örn. `"unsupported"`
yanıtındaki `capability`/`trigger` alanları) bu dosyadan GEÇER ama bu
dosya onları hiç YORUMLAMAZ — anlamlarını yalnızca `BuilderMachine` +
onun KENDİ registry'si çözer (aşağıya bkz., §3).

### 2. Konuşma bağlamı: OPAK round-trip, tam bir `ConversationContext` portu DEĞİL

`Entities`/`IntentResult`'ın (Normalized<T> sarmalayıcılar dahil) tüm
karmaşıklığını Swift'e taşımak yerine, `conversation` JSON alanı
`AnyCodable` olarak OPAK taşınır: `HTTPBackedPlanner` onu hiç yorumlamaz,
bir sonraki istekte AYNEN geri gönderir. Yalnızca TEK bir alt-alanı
(`currentPlan`) — `needs_clarification` durumunda backend'in ZATEN
çözdüğü (capability id'leri dahil) tam taslağı okumak için — çıkarır
(`extractCurrentPlan`). Bu, "her turda yalnızca son cümleyi değil, tüm
bağlamı gönder" gereksinimini, Swift'te TS'nin `Entities` tipini
yeniden yazmadan karşılar; gerçek bir backend'e karşı (bkz. §5)
3 turlu düzeltme senaryosuyla doğrulandı.

### 3. `unsupported` → `PlannerResult` üzerinden DEĞİL, TS `NluPlannerAdapter` ile AYNI desen

`PlannerResult` (Ports.swift) hâlâ yalnızca `.plan`/`.notUnderstood`
biliyor — Phase 1'den beri değişmedi, DEĞİŞTİRİLMEDİ. Backend
`"unsupported"` döndüğünde (Phase 4B'nin registry çözümü sonucu),
`HTTPBackedPlanner` backend'in verdiği `capability`/`trigger` id'lerini
minimal bir `DraftAutomationPlan`'a gömüp `.plan(...)` olarak döner —
`BuilderMachine.submit()`'in KENDİ registry kontrolü
(`findUnavailableCapability`) bunu otomatik olarak doğru `.unsupported`
BuilderStep'ine çevirir; alternatifler de Swift'in KENDİ registry'sinden
(backend'in gönderdiği listeden DEĞİL) türer. Bu, `MockPlanner` için
zaten var olan, değişmeyen bir mekanizmanın yeniden kullanılması —
`TS NluPlannerAdapter`'ın senkron `Planner` portu için yaptığı TRIKI
birebir tekrarlar (bkz. `src/nlu/pipeline.ts`). Backend `trigger: null`
verirse (tetikleyici de çözülemediyse) `.notUnderstood`'a düşülür — TS
tarafının aynı durumdaki kendi fallback'iyle birebir.

Bunun için Phase 4B'nin `PlanningOutcome`'daki `"unsupported"` şekline
YENİ bir `trigger: string | null` alanı eklendi (`src/nlu/types.ts`,
`src/api/contract.ts`, `src/nlu/plan-builder.ts`) — HTTP yanıtı bu
olmadan Swift'in tetikleyici id'sini elde etmesinin YOLU yoktu (backend
bunu hesaplıyor ama daha önce dışa aktarmıyordu).

### 4. Zengin HTTP hata eşlemesi: `PlannerError` yan kanalı

`Planner` protokolünün dar sözleşmesi (`.plan`/`.notUnderstood`)
KIRILMADI. Bunun yerine `HTTPBackedPlanner.lastError: PlannerError?`
şu dört durumu ayrı ayrı raporlar (`PlannerError.swift`):

| HTTP | Anlamı | `PlannerError` |
|---|---|---|
| 200 | Draft plan / clarification / unsupported / not_understood | (yok — `PlannerResult` zaten ayırt eder) |
| 400 | İstek gövdesi/şeması geçersiz | `.invalidRequest(message:)` |
| 422 | İyi biçimli ama Validation zincirinden (izin/güvenlik) geçemeyen plan | `.validationFailed(issues:)` |
| 502 | LLM sağlayıcısı hiç çalışamadı (`provider_error`, Phase 4B) | `.providerUnavailable(message:)` |
| ağ hatası/zaman aşımı/beklenmeyen durum | — | `.plannerUnreachable(message:)` |

422, bu round'da backend'e YENİ eklendi (`server.ts`: `status:"plan"` +
`validation.ok:false` artık 200 değil 422 döner — gövde AYNI kalır,
yalnızca durum kodu ayrışır). Şu ana kadar hiçbir gerçek SwiftUI View
katmanı yok (bu paket yalnızca `AutomationCore` mantığını içeriyor); bu
yüzden `lastError` şimdilik gözlemlenebilir bir API — ileride bir UI
katmanı bunu switch'leyip kullanıcıya doğru mesajı gösterebilir. Amaç,
Phase 3B/3C boyunca kurulan "asla 'Bir sorun oluştu'ya ezme, gerçekten
BİLİNENİ raporla" disiplinini burada da sürdürmekti.

### 5. Test disiplini: TS Phase 4B'nin fake-provider deseni

`Tests/AutomationCoreTests/HTTPBackedPlannerTests.swift` (9 test)
gerçek ağ çağrısı YAPMAZ — `FakeTransport`, `PlanHTTPTransport`
protokolünü önceden hazırlanmış `(statusCode, body)` çiftleriyle uygular
(TS'teki `ClaudeMessagesClient` enjeksiyonunun birebir Swift karşılığı).
Kapsanan senaryolar: basit plan (Test A — EN ÖNEMLİSİ: draft'taki
capability id'nin backend yanıtından geldiğini, Swift kodunda hardcode
olmadığını kanıtlar), clarification (Test B), 3 turlu düzeltme + gerçek
`conversation` round-trip doğrulaması (Test C), unsupported'ın
`BuilderMachine` üzerinden doğru `.unsupported` adımına düştüğü tam
entegrasyon testi (Test D), provider_error'ın ayrı bir domain durumu
olarak yüzeye çıktığı test (Test E), artı 400/422/timeout eşlemeleri ve
statik capability-id-hardcode taraması.

**Ayrıca, otomatik test paketinin dışında, GERÇEK çalışan bir backend'e
karşı** (`npm run serve`, kural tabanlı varsayılan sağlayıcı — LLM
anahtarı bu ortamda yoktu) geçici bir yürütülebilir hedefle elle
doğrulandı: Sentry Mode tek-tur planı, 3 turlu düzeltme (yalnızca araç
değişti, tetikleyici/eylem korundu) ve unsupported akışının TAMAMI
gerçek HTTP + gerçek JSON decode ile çalıştı. Bu smoke test SIRASINDA
iki gerçek hata bulundu ve düzeltildi:
- `HTTPBackedPlanner` `grantedPermissions`'ı hep `[]` gönderiyordu —
  gerçek bir backend'e karşı HER izinli eylem 422 ile başarısız
  oluyordu. Düzeltme: `HTTPBackedPlanner`, `BuilderMachine`'in de
  kullandığı AYNI `PermissionService`'i enjekte alır artık.
- `MissingInfoField.optional`, backend'in JSON'unda yalnızca `true`
  iken yazılıyor (`false` iken alan tamamen YOK) — sentezlenmiş
  `Decodable` bunu `keyNotFound` ile reddediyordu. Düzeltme: özel bir
  `init(from:)`, `decodeIfPresent(... ) ?? false` kullanır (tıpkı
  `WorkflowStepDTO`/`AnyCodable`'daki gibi).

Bu iki bulgu, sahte transport'larla yazılan testlerin YETERLİ
OLMADIĞININ kanıtı — CLAUDE.md'nin "gerçek cihaz/backend entegrasyonu
mümkün değilse mock kullan ve bunu açıkça belirt" ilkesi burada da
işledi: mock'lar mimariyi doğrular, gerçek veri şeklini DOĞRULAMAZ.

### 6. Kapsam dışı (bilinçli olarak sonraki round'lara bırakıldı)

- Shortcuts kurulumu / `installed` / gerçek otomasyon çalıştırma —
  Phase 3C'de ayrı bir sınır olarak zaten doğrulandı; bu round'un konusu
  DEĞİL.
- `HTTPBackedPlanner`'ın gerçek bir SwiftUI View/ViewModel'e bağlanması
  — bu paket hâlâ yalnızca `AutomationCore` mantığını içeriyor, bir App
  hedefi yok.
- Gerçek Claude API'ye karşı Swift tarafından uçtan uca doğrulama — bu
  ortamda `LLM_API_KEY`/`ANTHROPIC_API_KEY` yoktu; yalnızca backend'in
  kural tabanlı (deterministik) varsayılan sağlayıcısına karşı
  doğrulandı. Gerçek LLM ile tekrarı, anahtar tanımlandığında aynı
  smoke test adımlarıyla elle yapılabilir.

## Phase 4D-1 — gerçek SwiftUI uygulama kabuğu (2026-09-19)

`HTTPBackedPlanner` artık gerçek bir SwiftUI arayüzden çalıştırılıyor —
`ios-bridge`'e yeni bir `AutomationUI` kütüphane hedefi (View/ViewModel)
ve pakedin dışında, `App/` altında gerçek, çalıştırılabilir bir Xcode
uygulaması eklendi.

### 1. `AutomationUI` neden `AutomationCore`'dan AYRI bir hedef

"Core" mantık (state machine, registry, HTTP client) SwiftUI'a
bağımlı OLMAMALI — ileride farklı bir sunum katmanı (örn. widget,
watchOS) aynı `AutomationCore`'u SwiftUI'sız kullanabilmeli. Tek yeni
tip `BuilderViewModel` (`AutomationUI/BuilderViewModel.swift`):
`BuilderMachine`'in `@Published var step`'ini Combine ile yeniden
yayınlar VE registry üzerinden **capability id → insan dili** çevirisini
yapar (`triggerSummary`/`actionSummaries`) — View'lar hiçbir zaman ham
`draft.trigger.type`/`step.type` göstermez.

### 2. Kapsam: `.previewConfirm`'de DURUR

Ekran akışı tam olarak istenen sırayı izler: Home (`HomeView`) →
Understanding ("Seni şöyle anladım", ✓/✎ — `UnderstandingView`) →
gerekirse MissingInfo (`MissingInfoView`, tek soru) → ReadyView
(`.previewConfirm`). `.setup` ve sonrası (Shortcuts kurulumu,
`installed`, `success`) bilinçli olarak BAĞLANMADI —
`AutomationRootView` bu durumları `ScopeBoundaryView`'e yönlendirir
("Kurulum akışı bu sürümde henüz bağlı değil"). `ReadyView` de aynı
notu (`.noTemplateAvailable`'ın kullanıcı diline çevrilmiş hâli, bir
sonraki round'un konusu) taşıyan bir yer tutucu gösterir; `create()`
ÇAĞRILMAZ.

Gerçek bir izin isteme ekranı henüz yok — `App/Sources/AutomationApp/
AutomationApp.swift`, backend'in Permission Validator'ının (HTTP 422)
önizlemeyi engellememesi için geniş, sabit bir izin kümesiyle
(`MockPermissionService`) başlar. Bu kasıtlı bir GEÇİCİ yer tutucu,
açıkça yorumlanmış durumda.

### 3. `App/` — gerçek, çalıştırılabilir Xcode projesi (XcodeGen)

SwiftPM tek başına gerçek bir iOS uygulama paketi (Info.plist, asset
catalog, code signing) üretemez; bu yüzden `App/project.yml`
(XcodeGen spesifikasyonu) `../ios-bridge`'i yerel bir paket bağımlılığı
olarak alan minimal bir `AutomationApp` hedefi ve bir
`AutomationAppUITests` UI test hedefi tanımlar. **`project.yml` tek
doğruluk kaynağıdır; `AutomationApp.xcodeproj` `xcodegen generate` ile
ÜRETİLİR** — kolaylık olsun diye (XcodeGen kurulu olmayan biri de
doğrudan Xcode'da açabilsin diye) commit edildi, ama `project.yml`
veya `Sources/`/`UITests/` altına dosya eklenince YENİDEN
ÜRETİLMELİDİR (`cd App && xcodegen generate`).

### 4. Doğrulama: gerçek iOS Simulator + gerçek backend + XCUITest

Bu ortamda fiziksel bir iPhone yok, ama TAM Xcode + iOS Simulator var —
bu yüzden doğrulama, mümkün olan en güçlü biçimde yapıldı:
`xcodebuild -project App/AutomationApp.xcodeproj -scheme AutomationApp
-destination 'platform=iOS Simulator,name=iPhone 17' test`, GERÇEKTEN
çalışan bir `npm run serve`e (kural tabanlı varsayılan sağlayıcı) karşı.
Üç XCUITest senaryosu (`App/UITests/AutomationAppUITests.swift`),
gerçek dokunma/yazma olaylarıyla:

- Basit bir plan ("Pil yüzde 20'ye düşünce...") → Understanding
  ekranına ulaşır.
- **EN ÖNEMLİ TEST**: Tesla Sentry Mode senaryosu → ekrandaki HİÇBİR
  statik metin bir capability id'ye benzemiyor (`"ios."`/`"tesla."`
  içeren bir dize YOK) — bu değişmez artık yalnızca kaynak
  taramasıyla/pipeline'da değil, GERÇEKTEN ÇALIŞAN bir uygulamada
  kilitli.
- Çok turlu düzeltme (klima → onay → "Hangi araç?" sorusu → "Tesla
  Model Y" seçimi → previewConfirm'e ulaşma).

Üçü de GERÇEKTEN geçti (ilk denemede). Ekran görüntüsüyle de elle
doğrulandı — "Seni şöyle anladım" ekranı registry açıklamalarını
gösteriyor, capability id yok.

**Bilinen bir kozmetik boşluk (kod hatası DEĞİL):** `ios.bluetooth.
disconnected`'ın registry `description`'ı ("Seçilen Bluetooth
cihazının bağlantısı kesildiğinde tetiklenir") teknik/Bluetooth
dilinde; mockup'taki "🚗 Arabadan uzaklaşınca" gibi araç-odaklı, emoji'li
bir metin DEĞİL. Capability id sızmıyor (asıl değişmez korunuyor) ama
bu bir İÇERİK/metin cilası — registry'deki `description` alanlarının
kullanıcı diline daha da yaklaştırılması ayrı, küçük bir sonraki adım.

### 5. Kapsam dışı (bilinçli olarak sonraki round'lara bırakıldı)

- Gerçek bir fiziksel iPhone'da çalıştırma — bu ortamda mümkün değil;
  aynı `App/AutomationApp.xcodeproj`, kullanıcının kendi Mac'inde
  gerçek cihaz hedefiyle açılıp çalıştırılabilir.
- Gerçek izin isteme UI'ı — şu an sabit/geniş bir mock.
- Kurulum akışı (Shortcuts/`installed`) — Phase 3C'de ayrı doğrulandı,
  bu round'da UI'ya bağlanmadı.
- **Phase 4D-2: gerçek Claude API smoke test'i** — bu UI hazır olduğuna
  göre bir sonraki adım; otomatik test paketine SOKULMAYACAK (yalnızca
  `LLM_API_KEY` tanımlıyken elle, `serve.ts`'in gerçek sağlayıcı yoluyla).
