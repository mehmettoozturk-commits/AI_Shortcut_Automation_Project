# Phase 5A — Real-device E2E & Persistence Validation Plan

Bu doküman kod içermez (İş 0 hariç — bkz. altta). Amacı: Phase 4'ün
bıraktığı yeri (backend + registry + `AutomationCore` + `AutomationUI`'nin
yalnızca `previewConfirm`'e kadar olan kısmı) gerçek bir iPhone'da,
metin girişinden **`installed`**'a kadar tek, kesintisiz bir akış olarak
kanıtlamak; ardından bu kaydın uygulama yeniden başlatıldıktan sonra da
hayatta kaldığını doğrulamak.

**Kapsam dışı (bilinçli):** Failure matrisi, gerçek NVIDIA soak testi,
15 capability'nin tek tek kapsam denetimi, ve Phase 5 release gate —
bunlar Faz 5'in kendi alt planları olarak ayrı dokümanlara bırakıldı
(bkz. §"Kapsam dışı" altta). Bu doküman yalnızca **1) uçtan uca akış**
ve **2) kalıcılık/restart** konularını kapsar.

---

## İş 0 — Önkoşul: Uygulama katmanındaki eksik bağlantı (test öncesi yapılmalı)

Bu bölüm bir test değil, testlerin çalışabilmesi için **önce tamamlanması
gereken implementasyon işi**dir. Aşağıdaki gerçek, çalışan implementasyonlar
zaten `AutomationCore` içinde mevcut ve test edilmiş durumda — ama gerçek
SwiftUI uygulaması (`App/Sources/AutomationApp/AutomationApp.swift`) hâlâ
bunların yerine mock kullanıyor, ve `AutomationRootView.swift` bu adımlar
için hiçbir gerçek ekran render etmiyor:

| Port | Mock (şu an `AutomationApp.swift`'te) | Gerçek implementasyon (zaten var, bağlanmamış) |
|---|---|---|
| `SetupService` | `MockSetupService` | `TemplateBackedSetupService` (`Platform/TemplateBackedSetupService.swift`) |
| `ShortcutsHandoff` | `MockShortcutsHandoff` | `UIKitShortcutsHandoff` (`Platform/ShortcutsHandoff.swift`) |
| `AutomationRepository` | `InMemoryAutomationRepository` | `FileBackedAutomationRepository` (`Platform/FileBackedAutomationRepository.swift`, Phase 3C-3'te yazıldı, dosya tabanlı JSON kalıcılık) |

Ayrıca `AutomationRootView.swift`'te şu not açıkça yazıyor:

> `installed`, `success` bu fazda BAĞLANMADI — bkz. `ScopeBoundaryView`.

yani `.setup`, `.userAssistedImport`, `.waitingForUser`, `.linkingTrigger`,
`.installed`, `.success`, `.setupFailed` durumlarının **hiçbiri** için
gerçek bir SwiftUI ekranı yok — hepsi tek bir placeholder (`ScopeBoundaryView`)
üzerinden geçiştiriliyor.

**Yapılacaklar (tek, temiz bir feature commit'i önerilir —
`feat: wire real setup/handoff/persistence into app shell`):**

1. `AutomationApp.makeViewModel()`'de üç mock'u gerçek implementasyonlarla
   değiştir. `FileBackedAutomationRepository` için gerçek bir dizin
   (`FileManager.default.urls(for: .applicationSupportDirectory, ...)`)
   kullanılmalı.
2. `ScopeBoundaryView`'in yerine, en azından şu ekranları ekle:
   - **Setup** (`.setup`): kurulum türüne göre (`userAssistedImport` /
     `guidedManual`) kısa bir açıklama + "Devam Et" butonu.
   - **Kestirmeler'e Aktar** (`.userAssistedImport`): handoff'u tetikleyen
     buton (`shortcutsHandoff`'u çağırır) → `.waitingForUser`'a geçer.
   - **Bekleniyor / "Ekledim"** (`.waitingForUser`): kullanıcı Kestirmeler
     uygulamasında işlemi tamamladığında bastığı "Ekledim" butonu.
   - **Tetikleyiciyi Bağla / "Bağladım"** (`.linkingTrigger`): registry'den
     gelen `steps` listesini gösterip kullanıcının Otomasyonlar
     sekmesinde elle bağladığını onayladığı "Bağladım" butonu.
   - **Kuruldu / Başarılı** (`.installed`, `.success`): özet + kapat/bitir.
   - **Kurulum Başarısız** (`.setupFailed`): `reason` mesajı + tekrar dene.
3. Kalıcılığı **görünür** kılmak için basit bir "Otomasyonlarım" giriş
   noktası ekle (yeni bir sekme/ekran olması şart değil — uygulama
   açılışında `repository.list()` sonucu boş değilse bir liste
   gösterilmesi yeterli). Bu olmadan Test 3/4'ü kullanıcı gözünden
   doğrulamanın bir yolu yok.
4. Bu iş bittiğinde: `swift build` + mevcut `AutomationUITests`/
   `AutomationAppUITests` yeşil kalmalı (bu iş SADECE yeni ekran/wiring
   ekliyor, mevcut `previewConfirm`'e kadar olan davranışı DEĞİŞTİRMEMELİ).
   Yeni ekranlar için ayrı, minimal unit/UI testleri eklenmesi beklenir
   ama bu doküman onların tam listesini zorunlu kılmıyor — asıl kanıt
   aşağıdaki gerçek cihaz testleridir.

**Bu iş bitmeden aşağıdaki testlerin hiçbiri çalıştırılamaz.**

### İş 0 SONUÇ (2026-09-19)

**TAMAMLANDI.** Üç mock gerçek implementasyonlarla değiştirildi
(`TemplateBackedSetupService`, `UIKitShortcutsHandoff`,
`FileBackedAutomationRepository`), altı yeni ekran eklendi
(`SetupView`, `UserAssistedImportView`, `WaitingForUserView`,
`LinkingTriggerView`, `InstalledView`/`SuccessView`, `SetupFailedView`),
`ReadyView`'in "Otomasyonu Oluştur" butonu `create()`'e bağlandı,
`HomeView`'a `repository.list()`'ten okuyan bir "Otomasyonlarım" listesi
eklendi. Doğrulama: `swift build` yeşil, `swift test` 45→45 (Core) +
3→4 (UI, yeni bir tam-zincir testi eklendi) = 49/49, gerçek Xcode UI
testi (`xcodebuild test`, gerçek rule-based backend + gerçek Simulator)
4/4. TS tarafına dokunulmadı (280/280 değişmeden yeşil). Detaylar:
`docs/ios-bridge.md` "Phase 5A İş 0" bölümü.

**Ancak testlere geçmeden önce ikinci, AYRI bir boşluk bulundu — bu kod
değil, registry İÇERİĞİ eksikliği:**

- Registry'de `guided_manual` + `availableInShortcuts: true` kombinasyonuna
  sahip HİÇBİR capability yok (tek `guided_manual` girdisi,
  `tesla.camera_action`, kasıtlı olarak Shortcuts'ta yok — `.setup`'a
  hiç ulaşmadan `.unsupported`'a düşer). **Test 1 bugünkü registry
  içeriğiyle çalıştırılamaz.**
- 14 `user_assisted_import` capability'sinin HİÇBİRİNDE `template` yok
  — `TemplateBackedSetupService.prepare()` bu yüzden HER ZAMAN
  `.noTemplateAvailable` döner, `prepareHandoff()` deterministik olarak
  `.setupFailed`'a düşer. **Test 2 bugün çalıştırılırsa kesin "kaldı"
  verir**, kodun bir hatası olmadan.

Bu yüzden Test 1/Test 2 aşağıda **İş 0.5** ile güncellendi — gerçek
cihaz testlerinden ÖNCE, ayrıca küçük bir içerik hazırlığı gerekiyor.

---

## İş 0.5 — Önkoşul: en az bir gerçek kurulum içeriği (Test 1/Test 2 için)

Bu da bir test değil, İş 0 gibi bir hazırlık — ama kod değil, **içerik**
hazırlığı (bkz. `TemplateBackedSetupService.swift`'in "İÇERİK BOŞLUĞU
(kod eksikliği DEĞİL)" notu). Kullanıcının kendi elle yapması gereken
adımlar:

1. **Test 2 için:** Shortcuts uygulamasında, registry'deki 14
   `user_assisted_import` capability'sinden biri için (örn.
   `tesla.sentry_mode.toggle`) basit, tek eylemli gerçek bir kestirme
   oluştur → "iCloud Bağlantısını Kopyala" ile bir paylaşım linki al →
   bu linki ve önerilen adı registry'deki o capability'nin `template`
   alanına (`{ iCloudURL, suggestedName }`) ekle → `contracts/generate.mjs`
   ile snapshot'ı yenile → Swift tarafına kopyala (bkz. mevcut
   "Contract snapshot pipeline" disiplini).
2. **Test 1 için:** Ya registry'de gerçekten `guided_manual` VE
   `availableInShortcuts: true` olan yeni bir capability tanımlanmalı
   (gerçek bir Apple/Shortcuts kısıtı bunu gerektiriyorsa), ya da Test 1
   tamamen çıkarılıp Phase 5A'nın kapsamı yalnızca `user_assisted_import`
   zinciriyle (Test 2) sınırlandırılmalı — hangisi tercih edileceği bir
   ÜRÜN kararı, bu doküman bunu dayatmıyor.

**Bu iş bitmeden Test 1/Test 2 gerçek cihazda `installed`'a ulaşamaz**
(Test 3, `installed`'a Test 1 veya 2 üzerinden ulaşmayı varsaydığı için
o da bu işe bağımlı). Test 4-6 bu boşluktan etkilenmez (Test 5 zaten
yalnızca `previewConfirm`'e kadar gidiyor, Test 6 Test 1/2'nin bir
tekrarıdır — aynı önkoşula tabi).

---

## Ön koşullar

- Fiziksel iPhone (Phase 3B'de kullanılan iPhone 16 Pro / iOS 26 tercih
  edilir — Shortcuts davranışı orada zaten karakterize edildi).
- Backend gerçek modda çalışıyor olmalı (`npm run serve`), telefonun
  Mac'in loopback'ine ulaşabildiği doğrulanmış olmalı (Phase 4D-1'de
  zaten doğrulandı).
- **Provider seçimi:** Ana akış testleri (Test 1-4) için `LLM_PROVIDER`
  varsayılan **rule-based** (Claude/NVIDIA gibi bir LLM'e bağlı KALMADAN)
  çalıştırılmalı — amaç UI/persistence/Shortcuts mekaniklerini test
  etmek, model kalitesini değil (o, Phase 4D-2/4E-3'te ayrıca ele
  alındı ve Phase 5'in soak-test alt fazında tekrar ele alınacak).
  Test 5 (opsiyonel) tek bir gerçek LLM (NVIDIA) çağrısıyla tekrarlanır
  — sadece "gerçek model çıktısıyla da aynı akış çalışıyor mu" diye.
- Basit (guided_manual) BİR capability ve Shortcuts-handoff gerektiren
  (user_assisted_import) BİR capability seçilmeli — registry'den, hangi
  capability'lerin hangi `SetupKind`'e sahip olduğu
  `docs/capabilities.md`'den kontrol edilerek.
- Kayıt: her testin sonucu ekran görüntüsü/video ile belgelenmeli (Phase
  3B disiplini korunuyor).

---

## Testler

### Test 1 — Uçtan uca akış: guided_manual capability (P0)

**Sorulan soru:** Metin girişinden `installed`'a kadar olan TÜM zincir
(`capturing → understanding → previewConfirm → setup → installed →
success`) gerçek cihazda, gerçek dokunuşlarla eksiksiz tamamlanabiliyor
mu?

**Adımlar:**
1. `guided_manual` kurulum gerektiren bir capability için doğal dilde
   girdi yaz (örn. bildirim/hatırlatma tabanlı basit bir senaryo).
2. Preview ekranında onayla.
3. Setup ekranında gösterilen adımları takip et, "Kuruldu" onayı ver.
4. `installed`/`success` ekranının göründüğünü doğrula.

**Geçti:** Her ekran geçişi state machine'in beklediği sırayla gerçekleşir,
hiçbir adımda `ScopeBoundaryView` veya boş ekran görünmez, son ekran
kullanıcıya net bir "kuruldu" mesajı verir.
**Kaldı:** Bir adımda ekran eksik/yanlış/çöküyor, veya `installed`
durumuna hiç ulaşılamıyor.

---

### Test 1 SONUÇ (beklemede)

---

### Test 2 — Uçtan uca akış: user_assisted_import + Shortcuts handoff (P0)

**Sorulan soru:** `userAssistedImport → waitingForUser ("Ekledim") →
linkingTrigger ("Bağladım") → installed` zinciri, gerçek Shortcuts
handoff'u (Phase 3B/3C'de doğrulanan mekanizma) kullanarak uçtan uca
tamamlanabiliyor mu?

**Adımlar:**
1. `user_assisted_import` gerektiren bir capability için girdi yaz
   (örn. Tesla Sentry Mode senaryosu).
2. Preview → Setup → "Kestirmeler'e Aktar" butonuna bas, gerçekten
   Shortcuts uygulamasına geçildiğini doğrula.
3. Shortcuts'ta işlemi tamamla, uygulamaya dön, "Ekledim" bas.
4. Uygulamanın gösterdiği adımlara göre Otomasyonlar sekmesinde
   tetikleyiciyi elle bağla, "Bağladım" bas.
5. `installed` ekranının göründüğünü doğrula.

**Geçti:** Handoff gerçekten Shortcuts'ı açar, "Ekledim"/"Bağladım"
butonları doğru state geçişlerini tetikler, son ekran `installed` olur.
**Kaldı:** Handoff çalışmıyor, veya "Ekledim"/"Bağladım" sonrası state
beklenenden farklı / kilitleniyor.

**Not:** Bu testte uygulamanın kurulumun GERÇEKTEN Shortcuts tarafında
tamamlandığını programatik olarak BİLEMEDİĞİ zaten mimari bir gerçek
(bkz. `BuilderStep.swift` yorumları) — bu test bunu bir kusur olarak
DEĞİL, kullanıcı beyanına dayanan tasarım kararı olarak değerlendirir.

---

### Test 2 SONUÇ (beklemede)

---

### Test 3 — Kalıcılık: tam kapat/aç, `installed` sonrası (P0)

**Sorulan soru:** Test 1 veya Test 2 ile `installed` durumuna ulaşılmış
bir kayıt, uygulama tamamen kapatılıp (force quit, arka planda bile
bırakılmadan) yeniden açıldığında hâlâ görünüyor mu?

**Adımlar:**
1. Test 1 veya 2'yi tamamla, `installed` durumuna ulaş.
2. Uygulamayı App Switcher'dan tamamen kapat (force quit).
3. Uygulamayı yeniden aç.
4. "Otomasyonlarım" girişinde (bkz. İş 0, madde 3) kaydın hâlâ listede
   olduğunu doğrula.

**Geçti:** Kayıt, adı/durumuyla birlikte listede görünür (JSON dosyası
`~/Library/Application Support/.../automations.json`'da fiziksel
olarak kalıcı).
**Kaldı:** Kayıt kayboluyor, veya uygulama açılışta çöküyor/boş ekran
gösteriyor.

**Sonuç etkisi:** Hayır çıkarsa, `FileBackedAutomationRepository`'nin
gerçek uygulama sandbox'ında (simülatör/unit test'ten farklı olarak)
dosya yazma izni/yol sorunu olabilir — birim testleri bunu yakalamaz
çünkü onlar enjekte edilmiş geçici dizinler kullanır.

---

### Test 3 SONUÇ (beklemede)

---

### Test 4 — Kalıcılık: yarım kalmış kurulum sırasında kapat/aç (P1)

**Sorulan soru:** Kullanıcı `waitingForUser` veya `linkingTrigger` gibi
ARA bir durumdayken uygulamayı kapatıp açarsa ne olur? (Bu durumlar
henüz `repository.save()` ile kalıcılaştırılmamış olabilir — bu testin
amacı bunu netleştirmek, örtük bir varsayımda bulunmamak.)

**Adımlar:**
1. Test 2'nin 3. adımına kadar ilerle (Shortcuts'a geçildi, henüz
   "Ekledim" denmedi).
2. Uygulamayı force quit et, yeniden aç.
3. Uygulamanın davranışını gözlemle: `idle`'a mı döner, yoksa
   `waitingForUser`'ı hatırlayıp kaldığı yerden mi devam eder?

**Geçti / Kaldı yok — bu test bir DAVRANIŞ TESPİTİDİR, pass/fail değil.**
Gözlemlenen davranış ne olursa olsun `docs/ux.md`'ye açıkça yazılmalı:
eğer state kayboluyorsa bu bilinen bir sınır olarak belgelenir (ve
kullanıcıya "taslak kayboldu, baştan başla" gibi net bir mesaj
gösterilmesi gerekip gerekmediği ayrı bir UX kararı olur); eğer
kaldığı yerden devam ediyorsa bunun hangi mekanizmayla (state'in de
kalıcılaştırılması) olduğu belgelenir.

---

### Test 4 SONUÇ (beklemede)

---

### Test 5 — Clarification + düzeltme akışı, gerçek cihazda (P1)

**Sorulan soru:** Eksik bilgi (`missingInfo`) ve kullanıcı düzeltmesi
("✎ Değiştir" → `revise()` → yeniden metin girişi) akışları gerçek
dokunuşlarla, gerçek klavye ile sorunsuz çalışıyor mu?

**Adımlar:**
1. Kasıtlı eksik bir girdi yaz (örn. araç/cihaz belirtmeden bir Tesla
   senaryosu).
2. Sorulan soruya seçenekten cevap ver, `previewConfirm`'e ulaş.
3. "✎ Değiştir" ile geri dön, farklı bir girdi yaz, doğru şekilde
   yeniden `understanding`'e ulaştığını doğrula.

**Geçti:** Her iki geçiş de (soru cevaplama, düzeltme) beklenen state'e
ulaşır, klavye/odak davranışı doğal.
**Kaldı:** State kayboluyor, ekran donuyor, veya düzeltme eski taslağı
karıştırıyor.

---

### Test 5 SONUÇ (beklemede)

---

### Test 6 — Aynı akış, gerçek LLM provider ile (P1, opsiyonel)

**Sorulan soru:** Test 1 veya 2'deki akış, rule-based yerine gerçek bir
LLM sağlayıcısı (`LLM_PROVIDER=nvidia`, maliyet bilinciyle TEK istek)
ile çalıştırıldığında da aynı şekilde `installed`'a ulaşıyor mu?

**Amaç:** UI/persistence katmanının provider seçiminden bağımsız
olduğunu bir kez gerçek modelle doğrulamak — bu, Phase 4E-3'ün provider
kalite çalışmasını TEKRARLAMAZ, sadece uçtan uca entegrasyonu bir kez
gerçek modelle teyit eder.

**Geçti/Kaldı:** Test 1/2 ile aynı kriterler; ek olarak modelin ürettiği
plan içeriğinin (isim, tetikleyici özeti) `displayDescription` ile
tutarlı, teknik olmayan bir dille kullanıcıya sunulduğu doğrulanır.

---

### Test 6 SONUÇ (beklemede)

---

## Sonuç matrisi

| Test | Öncelik | Sonuç | Not |
|---|---|---|---|
| 1 — guided_manual E2E | P0 | beklemede | |
| 2 — user_assisted_import E2E + handoff | P0 | beklemede | |
| 3 — kalıcılık (installed sonrası kapat/aç) | P0 | beklemede | |
| 4 — kalıcılık (ara durumda kapat/aç) | P1 | beklemede (davranış tespiti) | |
| 5 — clarification + düzeltme | P1 | beklemede | |
| 6 — gerçek LLM ile E2E | P1 (opsiyonel) | beklemede | |

---

## Bu testlerden sonra

- Test 1-3 (P0) geçmezse: Phase 5A kapanmaz, önce kök neden
  (implementasyon hatası mı, sandbox/izin sorunu mu) giderilir ve aynı
  test tekrarlanır.
- Test 4'ün sonucu ne olursa olsun `docs/ux.md`'ye bir "ara durum
  kalıcılığı" notu eklenir — bu, Phase 5'in ilerleyen bir alt fazında
  (persistence hardening) ele alınıp alınmayacağına karar vermek için
  gereken girdiyi sağlar.
- Tüm sonuçlar `docs/capabilities.md`'deki ilgili capability'lerin
  `evidence` seviyesine işlenir (CLAUDE.md'deki kural: gerçek cihaz
  kanıtı olmadan hiçbir kurulum yöntemi "çalışıyor" varsayılamaz).

## Kapsam dışı (Phase 5'in diğer alt fazları — ayrı dokümanlar)

Kullanıcının Phase 5 taslağında sıraladığı, bu dokümanın KASITLI olarak
kapsamadığı konular, ileride ayrı SPEC/PLAN dokümanları olarak ele
alınacak:

- **Failure matrisi** (şablon eksik, Shortcuts açılmıyor, kullanıcı
  onaylamıyor, unsupported, provider_error, network timeout) → Phase 5B.
- **Gerçek NVIDIA soak testi** (aynı intent'lerin tekrarı, first-pass/
  repair/final-error oranları, hataya eğilimli intent'lerin tespiti) →
  Phase 5C.
- **15 capability'nin kapsam denetimi** (her biri için semantic→registry→
  setup→kullanıcı onayı→kalıcılık zincirinin "kanıtlanmış" mı yoksa
  "sadece registry'de tanımlı" mı olduğunun ayrıştırılması) → Phase 5D.
- **Phase 5 release gate** (TS/Swift/UI/gerçek cihaz/provider/kalıcılık/
  unsupported/güvenlik/temiz ağaç kontrol listesi) → Phase 5E, yalnızca
  5A-5D kapandıktan sonra.
