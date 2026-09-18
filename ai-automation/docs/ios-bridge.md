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
şekille eşleştiğini iddia ediyor — ama **bu test Xcode'da
çalıştırılmadı**, yalnızca yazıldı.

## 4. Builder state machine portu — neye dikkat edildi

`BuilderMachine.swift`, `machine.ts`'in birebir çevirisidir. Özellikle
korunan değişmezler:

- `installed`/`success`'e girmenin tek yolu `confirmInstalledByUser()`.
  `create()`, `prepareHandoff()`, `handOffToShortcuts()` — hiçbiri
  otomasyonu kaydetmez.
- `waitingForUser`'dan otomatik ilerleme yok (zamanlayıcı/varsayım yok).
- Kurulum yöntemi (`resolveSetupKind`) yalnızca registry'den okunur;
  `automatic` hiçbir yerde üretilmez — zaten `CapabilityRegistry.init`
  böyle bir satırı bulursa fırlatır (`assertNoUnprovenAutomaticInstall`).
- Üç seviyeli araç çözümlemesi (`CapabilityResolver.resolveTrigger`)
  CarPlay → Bluetooth → Konum sırasını TS resolver'ıyla aynı şekilde
  uyguluyor.

`BuilderMachineTests.swift` bu değişmezleri XCTest olarak ifade ediyor
(yine: **çalıştırılmadı**).

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
| A | `shortcuts://import-shortcut?url=...` bir `.shortcut` eylem dizisini içe aktarır | **kısmen REDDEDİLDİ (gerçek cihaz, 2026-09-18)** | Mekanizmanın kendisi çalışıyor (URL tanınıyor, işleniyor) AMA imzasız içerik kategorik olarak reddediliyor: "Importing unsigned shortcut files is not supported." Bkz. `docs/phase3b-validation-plan.md` Test 1 SONUÇ. Apple-imzalı (iCloud) bir şablonla aynı yol henüz test edilmedi — açık soru. |
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
