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

## İş 0.5 — Önkoşul: en az bir gerçek kurulum içeriği (Test 2 için)

Bu da bir test değil, İş 0 gibi bir hazırlık — ama kod değil, **içerik**
hazırlığı (bkz. `TemplateBackedSetupService.swift`'in "İÇERİK BOŞLUĞU
(kod eksikliği DEĞİL)" notu).

**Test 1 (guided_manual) bilinçli olarak buna dahil DEĞİL** — mevcut
tek `guided_manual` capability'si (`tesla.camera_action`) kasıtlı olarak
Shortcuts'ta yok, ve yeni bir `guided_manual` capability sırf bu testi
yeşile çevirmek için eklenmeyecek. Bu, ayrı bir ürün kararı (A: Test 1'i
kapsamdan çıkar, B: gerçekten ihtiyaç duyulan bir `guided_manual`
capability belirle) — Phase 5A bu kararı vermeden **Test 1 BLOCKED
kalır**, bu bir hata değil.

**Seçilen capability (Test 2 için): `ios.notification.show`**
(`semantic: "notify"`, `permissions: ["notifications"]`, `riskLevel:
"low"`). Gerekçe: Tesla hesabı/araç veya eşleştirilmiş bir Bluetooth
cihazı GEREKTİRMİYOR, tek eylemli (Apple'ın native "Show Notification"
eylemi — Phase 3B Test 1'de zaten kullanılan AYNI eylem türü), ve amaç
capability'nin kendisini değil `user_assisted_import → installed`
zincirinin MEKANİZMASINI kanıtlamak. Bu aynı zamanda Phase 3B Test 1'in
açık bıraktığı soruyu ("Apple/iCloud tarafından imzalanmış bir shortcut
aynı `shortcuts://import-shortcut?url=<icloud-link>` yoluyla dener mi?")
kapatıyor.

### Kullanıcının (fiziksel iPhone + Shortcuts uygulamasında) elle yapması gerekenler

1. Shortcuts uygulamasında yeni bir kestirme oluştur, TEK eylem ekle:
   **"Show Notification"** (metin: örn. "Test bildirimi").
2. Kestirmeyi adlandır (örn. "Bildirim Göster") — bu isim
   `suggestedName` olacak.
3. Kestirmenin paylaşım menüsünden **"iCloud Bağlantısını Kopyala"**
   (Copy iCloud Link) ile bir link al.
4. Bu linki (ve kullandığın adı) bana ilet — ben registry'ye
   `ios.notification.show`'un `template: { iCloudURL, suggestedName }`
   alanı olarak ekleyeceğim.

### Ben (kod tarafı) linki aldıktan sonra yapacaklarım

1. `registry.ts`'de `ios.notification.show`'a `template` alanını ekle.
2. `checkRegistryContract()` + `npx tsx contracts/generate.mjs` ile
   contract/snapshot'ı doğrula ve yenile.
3. Snapshot'ı `ios-bridge/Sources/AutomationCore/Resources/`'a kopyala.
4. TS + Swift + gerçek Xcode UI regression çalıştır, sonuçları raporla.
5. `git status` ile temiz ağaç doğrula, ayrı bir commit at (örn.
   `feat: add real Shortcuts template for ios.notification.show`).

**Not:** Template eklenmiş olması `.setupFailed`'ı ORTADAN KALDIRMAZ —
yalnızca "içerik yok" nedenini eler. Gerçek cihazda import gerçekten
başarısız olursa (imza/format sorunu vb.) sistem yine dürüstçe
`.setupFailed`'a düşmeli; `prepareHandoff()`/`handOffToShortcuts()`
hiçbir aşamada "içe aktarma kesin başarılı" varsaymaz — Phase 3B Test 7
bulgusu (`shortcuts://import-shortcut` başarı/başarısızlığı OS'tan geri
bildirilmiyor) burada da geçerli: kullanıcı "Ekledim" demeden `installed`
asla üretilmez.

**Bu iş bitmeden Test 2, ona bağımlı Test 3 (`installed` sonrası
kalıcılık), Test 4 (`.waitingForUser`'a ulaşmak `prepareHandoff()`'un
başarılı olmasını gerektiriyor) ve Test 2'nin gerçek LLM'li tekrarı olan
Test 6, gerçek cihazda çalıştırılamaz.** Yalnızca Test 5 bu boşluktan
tamamen bağımsız — o zaten yalnızca `previewConfirm`'e kadar gidiyor.

### İş 0.5 SONUÇ (2026-09-19)

**TAMAMLANDI.** Kullanıcı gerçek iPhone'unda Shortcuts uygulamasında
tek eylemli ("Show Notification") bir kestirme oluşturup iCloud
bağlantısını paylaştı: `https://www.icloud.com/shortcuts/6cce8a476d664f34997734f87f95fc4b`
("Bildirim Göster"). Bu link `ios.notification.show`'un `template`
alanına eklendi, contract/snapshot yenilendi, Swift Resources'a
kopyalandı. Doğrulama: TS 280/280, Swift 46 (Core, +1 yeni
`testTemplateAvailable_forNotificationShow`) + 4 (UI) = 50/50, gerçek
Xcode UI testi 4/4 — hepsi tek commit'te (`feat: add real Shortcuts
template for ios.notification.show`).

**Test 2 için önerilen gerçek cihaz girdisi:** "Pil yüzde 20'ye
düşünce bana haber ver" — rule-based sağlayıcıyla doğrudan
`ios.notification.show` eylemine çözümlendiği zaten `curl` ile
doğrulandı (`notifications` izni dışında bir bağımlılığı yok).

**Henüz doğrulanmayan (yalnızca gerçek cihazda kanıtlanabilir):**
iCloud linkinin `shortcuts://import-shortcut?url=...` ile GERÇEKTEN
içe aktarılıp aktarılmadığı — Phase 3B Test 1'in açık bıraktığı soru
budur, ve tam olarak Test 2'nin konusu. Kod tarafı (registry okuma,
`prepareHandoff`/`handOffToShortcuts` çağrısı, "Ekledim"/"Bağladım"
onayları) doğrulandı; OS'un bu linki gerçekten kabul edip Shortcuts'a
aktarması henüz test EDİLMEDİ.

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

### Test 2 SONUÇ (2026-09-19, gerçek iPhone, Wi-Fi üzerinden Mac'teki rule-based backend'e bağlı)

**PASS.**

- **Ortam:** Fiziksel iPhone (kullanıcının kendi Apple ID/Team'iyle
  imzalanmış gerçek cihaz derlemesi) + Mac'te `npx tsx src/api/serve.ts`
  (rule-based, `LLM_PROVIDER` tanımsız) + `PLAN_BACKEND_URL=http://192.168.1.116:3000/plan`
  (Run scheme env var), aynı Wi-Fi ağı.
- **Girdi:** "Pil yüzde 20'ye düşünce bana haber ver."
- **Beklenen:** Anlama ekranı → Kestirmelere Aktar → Shortcuts açılır →
  "Bildirim Göster" içe aktarılır → Ekledim → tetikleyici bağlama →
  Bağladım → installed/success → Otomasyonlarım'da görünür.
- **Gerçekleşen:** Tam olarak beklenen sırayla gerçekleşti. "Seni şöyle
  anladım" ekranı geldi; "Kestirmelere Aktar"a basınca Shortcuts
  uygulaması GERÇEKTEN açıldı ve "Bildirim Göster" kestirmesi kütüphaneye
  içe aktarıldı (kullanıcı gözle doğruladı); uygulamaya dönüp "Ekledim"
  dendi, tetikleyici bağlama adımına geçildi, "Bağladım" dendi, kuruldu/
  başarılı ekranına ulaşıldı, Otomasyonlarım listesinde göründü.
- **PASS / FAIL / BLOCKED:** **PASS.**
- **Kanıt:** Kullanıcı gözlemi (ekran akışı + Shortcuts kütüphanesinde
  gerçek içe aktarma), bu oturumda kayıt altına alındı.
- **Not:** Bu, Phase 3B Test 1'in açık bıraktığı soruyu kapatıyor —
  Apple/iCloud tarafından GERÇEKTEN imzalanmış bir kestirme,
  `shortcuts://import-shortcut?url=<icloud-link>` ile sorunsuz içe
  aktarılıyor (Test 1'in kanıtladığı ret yalnızca İMZASIZ içerik
  içindi). Yol boyunca ayrı, kod dışı iki altyapı sorunu bulunup
  çözüldü: (1) `App/project.yml`'deki `CODE_SIGNING_ALLOWED: NO` gerçek
  cihaz kurulumunu engelliyordu → `CODE_SIGN_STYLE: Automatic`'e
  geçildi (`09e0691`); (2) Xcode scheme'inde `PLAN_BACKEND_URL` değeri
  yanlış yazılmıştı (`ttp://` — baştaki `h` eksik), düzeltilince
  bağlantı çalıştı. İkisi de kod/ürün mantığı değişikliği değil.

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

### Test 3 SONUÇ (2026-09-19, gerçek iPhone)

**PASS.**

- **Ortam:** Fiziksel iPhone, Test 2'de kurulan "Bildirim Göster"
  otomasyonu (`installed`) yerinde.
- **Girdi:** (Yeni girdi yok — Test 2'nin ürettiği kayıt kullanıldı.)
- **Beklenen:** Uygulama App Switcher'dan tamamen kapatılıp (force
  quit) yeniden açıldığında, otomasyon Otomasyonlarım listesinde hâlâ
  görünmeli (`~/Library/Application Support/.../automations.json`'dan
  gerçekten yeniden okunarak).
- **Gerçekleşen:** Uygulama force quit edildi, yeniden açıldı, kayıt
  Otomasyonlarım listesinde görünmeye devam etti.
- **PASS / FAIL / BLOCKED:** **PASS.**
- **Kanıt:** Kullanıcı gözlemi, bu oturumda kayıt altına alındı.
- **Not:** `FileBackedAutomationRepository`'nin gerçek iOS sandbox'ında
  (Simulator/unit test'ten farklı olarak) dosya yazma/okuma izni ve
  yolunun doğru çalıştığını kanıtlıyor — Phase 5A İş 0 SONUÇ bölümünde
  belirtilen "birim testleri bunu yakalamaz" riski gerçek cihazda
  elendi.

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

### Test 4 SONUÇ (2026-09-20, Simulator — mimari sebeple cihazdan bağımsız)

**N/A — gözlem testi (PASS/FAIL yok, kasıtlı olarak).**

- **Ortam:** iPhone 17 Simulator, rule-based backend (localhost paylaşımı
  sayesinde LAN/signing derdi yok). Fiziksel cihazda değil — bkz. "Not".
- **Girdi:** "Pil yüzde 20'ye düşünce bana haber ver" →
  previewConfirm → "Otomasyonu Oluştur" → setup → "Kestirmelere Aktar"
  → userAssistedImport → "Kestirmeler'e Aktar" (handOff denendi).
- **Beklenen:** Davranış tespiti; PASS/FAIL yok.
- **Gerçekleşen:** `.waitingForUser`'a ulaşıldı. `app.terminate()` +
  yeniden `launch()` sonrası uygulama **doğrudan Home/idle ekranına
  döndü** — kaldığı ara duruma (waitingForUser/setupFailed) DÖNMEDİ.
- **PASS / FAIL / BLOCKED:** N/A — gözlem testi.
- **Kanıt:** Otomatik XCUITest
  (`AutomationAppUITests.testForceQuitMidSetup_observesRestartBehavior`),
  konsol çıktısı: `reachedWaitingForUser=true, backToHome=true,
  resumedMidSetup=false`.
- **Not:** Bu, fiziksel cihazda AYRICA teyit edilmedi ve edilmesine
  gerek görülmedi — çünkü ölçülen davranış Shortcuts'ın cihaz
  davranışı değil, `BuilderMachine.step`'in kendisi: `@Published`,
  yalnızca bellekte tutulan bir state, hiçbir yerde (dosya/repository)
  persist edilmiyor (yalnızca `pendingUser`/`installed`/`failed`
  otomasyon KAYITLARI kalıcı — akışın KENDİSİ değil). Bu yüzden restart
  sonrası HER ZAMAN idle'a dönmesi, cihazdan bağımsız, saf Swift state
  yönetiminin doğal sonucu. **Bu bir bug olarak sınıflandırılmadı** —
  mevcut mimarinin beklenen sonucu. Ancak kullanıcı açısından yarım
  kalmış bir kurulumun sessizce kaybolması, ileride ayrı bir UX/ürün
  kararı olarak ele alınabilir (örn. "yarım kalan otomasyon" bildirimi,
  ya da `step`'in de kalıcılaştırılması) — Phase 5A kapsamında kod
  DEĞİŞTİRİLMEDİ, yalnızca gözlem kaydedildi.

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

### Test 5 SONUÇ (2026-09-20, gerçek iPhone)

**PASS — E2E akış; görsel correction doğrulaması gözlemlenemedi.**

- **Ortam:** Fiziksel iPhone, rule-based backend.
- **Girdi:** "Arabadan inince klimayı aç." → Tesla Model Y → "✎ Değiştir"
  → Tesla Model 3.
- **Beklenen:** Correction sonrası yalnızca araç değişmeli; trigger/
  action korunmalı.
- **Gerçekleşen:** Akış kesintisiz tamamlandı. ReadyView'a ulaşıldı.
  Ancak ReadyView trigger/action/araç özeti göstermediği için
  correction'ın sonucu kullanıcı arayüzünden görsel olarak
  doğrulanamadı.
- **PASS / FAIL / BLOCKED:** PASS — E2E akış; görsel correction
  doğrulaması gözlemlenemedi.
- **Kanıt:** `testMultiTurnCorrection_onlyVehicleChanges` otomatik
  testi; fiziksel cihazda akışın başarıyla ReadyView'a ulaşması.
- **Not:** `ReadyView` bir UX eksikliği nedeniyle seçilen araç,
  tetikleyici ve eylemi göstermiyor — bu Test 5 kapsamında kod
  DEĞİŞTİRİLMEDİ, yalnızca gözlemlendi (bkz. UX backlog altta).

**Ayrı, Test 5 sırasında keşfedilen ikinci bir bulgu:** `BuilderMachine`
`close()`/`open()`'da `planner`'ın konuşma bağlamını HİÇ sıfırlamıyor
(`Planner` protokolü `resetConversation()`'ı bile tanımıyor — yalnızca
`HTTPBackedPlanner`'da var, hiç çağrılmıyor). Gerçek cihazda, önceki bir
denemenin (örn. Test 2/4) yanıtları uygulama process'i canlı kaldığı
sürece sonraki, alakasız bir otomasyon denemesine sessizce sızabiliyor
— bir manuel "arka plana at/geri getir" bunu SIFIRLAMIYOR, yalnızca
gerçek bir process sonlandırma (force quit ya da Xcode Stop→Run)
sıfırlıyor. Bu oturumda ampirik olarak doğrulandı (aynı girdi, gerçekten
taze bir process'te doğru soruyu sordu). **Kod DEĞİŞTİRİLMEDİ** — bu da
ayrı bir UX/mimari backlog maddesi (altta).

### UX backlog (Phase 5A'da kod değişikliği yapılmadı, yalnızca kaydedildi)

- `ReadyView`, kullanıcıya son otomasyonun **ne zaman / ne yapacağını /
  hangi cihazla** çalışacağını göstermeli (şu an yalnızca "Otomasyon
  hazır." + izin/disclosure metni gösteriyor).
- `BuilderMachine.close()`/`open()`, yeni bir otomasyon denemesine
  başlarken `planner`'ın konuşma bağlamını sıfırlamalı (`Planner`
  protokolüne bir `resetConversation()` eklenip çağrılması gerekebilir)
  — aksi halde alakasız denemeler arasında cevap sızıntısı riski var.
- `PlanHTTPTransport`'ta istemci tarafı özel bir zaman aşımı yok
  (URLSession varsayılanı kullanılıyor). Gerçek/ücretsiz LLM
  sağlayıcıları (örn. NVIDIA NIM) 100+ saniyeye varan gecikmeler
  gösterebiliyor (bkz. Test 6 SONUÇ) — bu, varsayılan zaman aşımını
  aşıp isteğin sessizce `.notUnderstood`'a düşmesine yol açabilir.
  Kullanıcıya "düşünülüyor, biraz sürebilir" gibi bir bekleme
  göstergesi ve/veya daha uzun, açıkça ayarlanmış bir zaman aşımı
  gerekebilir.

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

### Test 6 SONUÇ (2026-09-20, gerçek iPhone, `LLM_PROVIDER=nvidia`)

**PASS.**

- **Ortam:** Fiziksel iPhone + Mac'te `npm run serve` (`.env`'den
  `LLM_PROVIDER=nvidia`, gerçek NVIDIA NIM), LAN üzerinden.
- **Girdi:** "Pil yüzde 20'ye düşünce bana haber ver."
- **Beklenen:** Test 2 ile aynı zincir, bu kez gerçek LLM çıktısıyla:
  Anlama → Kestirmelere Aktar → Shortcuts import → Ekledim → Bağladım
  → installed/success.
- **Gerçekleşen:** İlk gerçek çağrı `provider_error` verdi (Phase
  4E-3'ün retry/repair katmanının 2 denemeden sonra hâlâ şema dışı
  çıktıya düştüğü, belgelenmiş/beklenen bir durum). İkinci gerçek
  çağrı (Mac'ten `curl` ile önceden doğrulandı) başarılı oldu, doğru
  şekilde `ios.notification.show`'a çözümlendi. Fiziksel cihazda aynı
  girdiyle tam zincir tamamlandı: Anlama ekranı geldi, kurulum akışı
  sürdürüldü, **installed/success'e ulaşıldı**, Otomasyonlarım'da
  göründü.
- **PASS / FAIL / BLOCKED:** **PASS.**
- **Kanıt:** Kullanıcı gözlemi (gerçek cihazda tam zincir), bu oturumda
  kayıt altına alındı; Mac'ten `curl` ile önceki doğrulama.
- **Not (önemli, ayrı bir bulgu):** Bir Mac-tarafı doğrulama isteği bu
  oturumda **110 saniye** sürdü (önceki bir istek yalnızca 22 saniyeydi)
  — NVIDIA'nın ücretsiz/küçük modelinin gecikmesi çok değişken.
  Kullanıcının ilk denemesinde gördüğü "Anlayamadım" muhtemelen bu
  yüzdendi: `PlanHTTPTransport`'ta özel bir zaman aşımı YOK (URLSession
  varsayılanı, tipik ~60sn kullanılıyor) — 60 saniyeyi aşan bir gerçek
  NVIDIA yanıtı, istemci isteği düşürüp sessizce `.notUnderstood`'a
  düşebilir (bkz. `HTTPBackedPlanner.plan()`'ın catch-all'ı). **Bu Test
  6 kapsamında kod DEĞİŞTİRİLMEDİ** — ama bu, gerçek/ücretsiz LLM
  sağlayıcılarıyla production'a çıkmadan önce ele alınması gereken
  somut bir gecikme/timeout riski olarak UX backlog'a eklendi (altta).

---

## Sonuç matrisi

| Test | Öncelik | Sonuç | Not |
|---|---|---|---|
| 1 — guided_manual E2E | P0 | BLOCKED (ürün kararı bekliyor) | Kasıtlı, bkz. İş 0.5 notu |
| 2 — user_assisted_import E2E + handoff | P0 | **PASS** (2026-09-19) | Phase 3B Test 1'in açık sorusunu kapattı |
| 3 — kalıcılık (installed sonrası kapat/aç) | P0 | **PASS** (2026-09-19) | |
| 4 — kalıcılık (ara durumda kapat/aç) | P1 | **N/A — gözlemlendi** (2026-09-20, Simulator) | step in-memory, restart→idle. Bug değil. |
| 5 — clarification + düzeltme | P1 | **PASS** (E2E; görsel correction doğrulaması BLOCKED) | 2026-09-20, ayrıca 2 UX bulgusu |
| 6 — gerçek LLM ile E2E | P1 (opsiyonel) | **PASS** (2026-09-20) | 1. deneme provider_error, 2. deneme installed'a ulaştı |

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

## Phase 5A Kapanış Özeti (2026-09-20)

Test 2, 3, 5, 6 gerçek fiziksel iPhone'da **PASS**; Test 4 Simulator'da
gözlemlendi (**N/A**, mimari sebeple cihazdan bağımsız); Test 1 kasıtlı
olarak **BLOCKED** kaldı (ürün kararı bekliyor, bkz. İş 0.5). Metin
girişinden `installed`/`success`'e ve Otomasyonlarım'a kadar TAM zincir
— hem rule-based hem gerçek NVIDIA çıktısıyla — gerçek cihazda kanıtlandı.

**Bu round'da bulunan, kod DEĞİŞTİRİLMEDEN kaydedilen 4 bulgu** (hepsi
yukarıdaki ilgili Test SONUÇ/UX backlog bölümlerinde detaylı):

1. `ReadyView` trigger/action/cihaz özeti göstermiyor (Test 5).
2. `BuilderMachine.close()`/`open()` planner konuşma bağlamını
   sıfırlamıyor — denemeler arası cevap sızıntısı riski (Test 5).
3. `PlanHTTPTransport`'ta istemci zaman aşımı yok; yavaş gerçek LLM
   yanıtları (110sn'ye kadar gözlemlendi) sessizce `.notUnderstood`'a
   düşebilir (Test 6).
4. `BuilderMachine.step` in-memory, restart'ta her zaman idle'a döner
   — ara durumdaki bir kurulum sessizce kaybolur (Test 4).

Bunların hiçbiri Phase 5A'yı kapatmayı engellemiyor (hepsi UX/hardening
niteliğinde, mimari bir çöküş değil) — ama Phase 5'in ileriki
fazlarında (özellikle 5E release gate) ele alınıp alınmayacağına karar
verilmesi gerekiyor.

**Sonraki adım:** Test 1 için ürün kararı (A: kapsamdan çıkar, B: yeni
bir `guided_manual` capability tanımla) ve/veya Phase 5B/5C/5D/5E'ye
geçiş.

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
