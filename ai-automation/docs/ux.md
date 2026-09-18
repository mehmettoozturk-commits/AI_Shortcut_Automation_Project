# UX Specification — Phase 1 (Mobil Ekranlar + Navigation/State Modeli)

**Durum:** Phase 1 UX Prototype tamamlandı (tıklanabilir demo, bkz. proje sohbet
geçmişi). Bu doküman o prototipi resmi ürün spesifikasyonuna çeviriyor: her
ekranın içeriği, durumları, geçişleri ve **AI Core** (`packages/automation-dsl`,
`packages/capability-registry`, validation pipeline) ile bağlantı noktaları.

**Bu doküman ne için var:** Claude Code'un Phase 3 (iOS MVP, SwiftUI) için
doğrudan çalışabileceği, ekran ekran tanımlanmış bir kaynak. CLAUDE.md kuralı
gereği ("Spec'i okumadan kod yazma") — SwiftUI implementasyonuna başlamadan
önce bu dokümanın ve `MASTER_SPEC.md`'nin okunması gerekir.

**Bu dokümanda olmayan şey:** Gerçek Intent/Entity Extraction mantığı (Phase
2) ve iOS native kod (Phase 3). Bu doküman, o iki fazın üzerine oturacağı
ekran/state iskeletini tanımlar — henüz onları implemente etmiyor.

---

## 0. Terminoloji notu

Kullanıcıya asla "trigger/action/condition" gösterilmez (MASTER_SPEC §3).
Ama bu doküman **mühendislere** yazıldığı için, ekran adlarının arkasındaki
teknik karşılıklarını (`AutomationPlan`, `Capability`, validation stage)
parantez içinde belirtiyorum. Bu terimler asla UI kopyasına sızmamalı.

---

## 1. Navigasyon Modeli

### 1.1 Üst seviye yapı

```
TabBar (persistent)
├── Ana Sayfa           ← varsayılan/landing tab
├── Otomasyonlarım       ← MASTER_SPEC'te "Otomasyonlar"; bu dokümanda
│                           kullanıcı diliyle "Otomasyonlarım" olarak
│                           yeniden adlandırıldı (bkz. §4)
├── Şablonlar
├── Aktivite
└── Ayarlar

FAB (persistent, tüm tab'larda görünür)
└── "+ Yeni Otomasyon" → Builder Flow'u modal olarak açar
```

Builder Flow, tab'ların **üzerinde** modal/sheet olarak açılır; hangi tab
açıkken tetiklenirse tetiklensin aynı akıştır ve bitince kullanıcıyı
**Otomasyonlarım**'a düşürür (yeni otomasyon orada görünür olmalı — bu,
§4'teki "en önemli ekran" prensibiyle tutarlı).

### 1.2 Builder Flow state machine

```
   idle
    │  (FAB veya Ana Sayfa girişi)
    ▼
 capturing ◀─────────────────────────────┐
    │  (Gönder)                           │ (✎ Değiştir — taslak korunur)
    ▼                                      │
 understanding ────────────────────────────┤
    │                                      │
    ├──[eylem desteklenmiyor]──▶ unsupported ──▶ guided_alternative
    │                              (alternatif seçilirse understanding'e döner)
    │
    ├──[entity belirsiz]──▶ missing_info ──┐
    │                                       │
    └──[entity net]────────────────────────┤
                                             ▼
                                   preview_confirm
                                             │  (Otomasyonu Oluştur)
                                             ▼
                                          setup            ← plan doğrulanır,
                                             │                kurulum paketi hazırlanır
                          ┌──────────────────┴──────────────┐
                          ▼                                  ▼
               user_assisted_import                   setup_failed
               ("Kestirmelere Ekle")                  (Tekrar dene → setup)
                          │
                          ▼
                 waiting_for_user      ← Apple'ın ekranına aktarıldı.
                          │               BURADAN OTOMATİK İLERLEME YOK.
             ┌────────────┴────────────┐
             ▼                          ▼
        installed                 setup_failed
     ("Ekledim")                  ("Ekleyemedim")
             │
             ▼
         success
```

`guided_manual` özel durumu: Shortcuts karşılığı olmayan bir eylemi
kullanıcı elle yapıyorsa, doğrulama doğrudan `setup` durumundan
`installed`'a geçer (aracı kullanıcı kendisi olduğu için ayrı bir
handoff adımı yok).

### 1.3 Neden bu state machine böyle kurgulandı

`missing_info` **koşullu** bir adım, sabit değil — MASTER_SPEC §3: "AI
yalnızca gerçekten eksik olan bilgiyi sorsun." Kullanıcının hesabına tek bir
Tesla bağlıysa, `understanding` ekranı aracı doğrudan gösterir ve
`missing_info` tamamen atlanır. Birden fazla araç bağlıysa ya da hiç araç
bağlı değilse, `missing_info` devreye girer. Bu davranış §3'ün UI
kopyasında ("Hangi araç?" sorusunun sadece gerçekten belirsizken
sorulması) ve kullanıcının kendi örneğinde (tek soruyla — "Hangi
Tesla'yı kullanalım?" — hemen önizlemeye geçmesi) birebir karşılığı.

---

## 2. Veri modeli köprüsü (UI state ↔ AI Core)

Builder Flow'un her state'i, `packages/automation-dsl` ve
`packages/capability-registry`'de zaten kodlanmış olan yapılara karşılık
gelir. Bu tablo, Claude Code'un Phase 2'de Intent/Entity katmanını
bağlarken hangi UI state'in hangi validation pipeline aşamasını
tetiklediğini gösterir:

| UI state | Üretilen/güncellenen veri | Tetiklenen pipeline aşaması |
|---|---|---|
| `capturing` → `understanding` | Ham metin → **taslak** `AutomationPlan` (henüz doğrulanmamış) | Schema Validator |
| `understanding` | `trigger.type`, `steps[].type` doldurulur | Capability Validator (bilinmeyen capability varsa kullanıcıya "bunu henüz yapamıyorum" gösterilmeli — bkz. §6.7 açık soru) |
| `missing_info` | `trigger.device` gibi eksik alanlar doldurulur | — (sadece veri toplama) |
| `preview_confirm` | Plan tamamlanır | Permission Validator (izin eksikse bu ekranda "X izni gerekiyor" satırı eklenir) |
| **"Otomasyonu Oluştur" butonuna basış** | — | **Bu tıklama, DSL'deki `ask_confirmation` adımının gerçek dünya karşılığıdır.** Safety Validator'ın aradığı "kullanıcı onayı" tam olarak burada gerçekleşir. |
| `setup` | Capability Registry'den `nativeSupport` okunur | Compiler (henüz yazılmadı — bkz. MASTER_SPEC §15 son aşama) |
| `success` | `Automation` domain nesnesi oluşturulur (`status: "active"`) | — |

**Önemli tasarım kararı:** `setup_native` vs `setup_guided` dallanması,
UI'da hardcode edilmiş bir if-else değil, doğrudan
`Capability.nativeSupport` alanından okunmalı. Bu sayede registry
güncellendiğinde (örn. Tesla ileride kamera desteği eklerse) UI kodu
değişmeden davranış otomatik doğru olur — CLAUDE.md: "Platform
capability'si doğrulanmadan entegrasyon yazma" ilkesinin UI tarafındaki
karşılığı budur.

---

## 3. Ekran ekran spesifikasyon

Her ekran için: **Amaç / İçerik / Durumlar / Geçişler / Notlar** formatı
kullanılıyor.

### 3.1 Ana Sayfa

**Amaç:** Giriş noktası; ya serbest metin/ses ile başlar ya da kategori
üzerinden hızlı başlangıç sağlar.

**İçerik:**
- Başlık: "Bugün neyi otomatikleştirelim?"
- Giriş kartı: "Ne yapmak istediğini yaz…" (placeholder) + 🎙️ Konuş butonu
- Kategori çipleri: 🚗 Arabam · 💬 Mesajlar · 💊 Hatırlatıcılar · 🏠 Ev ·
  📍 Konum · 🔋 Telefon
- "Son otomasyonların" — Otomasyonlarım'daki ilk 3 kart, aynı bileşenle

**Kategori çipi davranışı:** Bunlar spesifik komut değil, **başlangıç
noktası**. Dokunma, `capturing` state'ini o kategoriye ait temsili bir
örnek cümleyle önceden doldurur (kullanıcı düzenleyip gönderir):

| Çip | Ön dolu örnek metin |
|---|---|
| 🚗 Arabam | "Arabadan inince ___" |
| 💬 Mesajlar | "___'den mesaj gelince ___" |
| 💊 Hatırlatıcılar | "Her ___ bana ___ hatırlat" |
| 🏠 Ev | "Eve gelince ___" |
| 📍 Konum | "___'e yaklaşınca ___" |
| 🔋 Telefon | "Pil ___ altına düşünce ___" |

**Durumlar:** "Son otomasyonların" boşsa (yeni kullanıcı) bu bölüm hiç
gösterilmez — boş bir kart/placeholder yerine bölüm tamamen kaldırılır
(§19: "az metin", gereksiz boşluk mesajı yok).

**Geçişler:** Giriş kartına veya çipe dokunma → `capturing` (Builder Flow
açılır, modal).

---

### 3.2 Ses/Yazı (`capturing`)

**Amaç:** Kullanıcının niyetini serbest metin veya sesle almak.

**İçerik:**
- Metin alanı (çip'ten geldiyse önceden dolu, imleç düzenlenebilir yerde)
- 🎙️ Konuş butonu — basılı tutulduğunda "Dinliyorum…" durumuna geçer,
  konuşma metne **canlı olarak** dökülür (§16: "Kullanıcı konuşurken
  metnin canlı gösterilmesi güven artırır")
- Gönder butonu — metin alanı boşken pasif (dokunulamaz), dolduğunda aktif

**Durumlar:**
- `empty` — Gönder pasif
- `listening` — mikrofon aktif, canlı transkript akıyor
- `ready` — metin var, Gönder aktif

**Geçişler:** Gönder → `understanding`. ✕ → `idle` (Builder Flow kapanır,
hiçbir şey kaydedilmedi).

**Anlaşılamayan girdi:** AI niyeti çözemezse `capturing` ekranı
`not_understood` durumuna geçer (aynı ekran, girdi silinmez) — bkz. §7.2.

---

### 3.3 AI Anlama (`understanding`)

**Amaç:** AI'nin çıkardığı niyeti kullanıcıya doğrulatmak — teknik detay
göstermeden, akış diyagramıyla.

**İçerik (kullanıcının verdiği örnek üzerinden):**

```
Seni şöyle anladım:

🚗 Tesla'dan ayrıldığında
        ↓
🛡️ Sentry Mode'u aç

Tesla Model Y
```

- Araç satırı **sadece** entity net şekilde çözülebildiyse gösterilir
  (bkz. §1.3). Çözülemediyse bu satır yok, doğrudan `missing_info`'ya
  geçilir.
- Butonlar: **✓ Doğru** (primary) · **✎ Değiştir** (secondary)

**Durumlar:**
- `resolved` — araç/entity biliniyor, satır gösteriliyor
- `unresolved` — araç bilinmiyor, satır yok

**Geçişler:**
- ✓ Doğru, `resolved` ise → `preview_confirm`
- ✓ Doğru, `unresolved` ise → `missing_info`
- ✎ Değiştir → `capturing` (mevcut metinle geri döner)

**Açık soru → kapatıldı:** AI'nin çıkardığı niyet yanlışsa, "✎ Değiştir"
kullanıcıyı serbest metinle **revizyona** götürür ve mevcut taslak plan
korunur — bkz. §7.1.

---

### 3.4 Eksik Bilgi (`missing_info`)

**Amaç:** Sadece gerçekten eksik olan **tek** bilgiyi sormak.

**İçerik:**
- Başlık: "Hangi Tesla'yı kullanalım?"
- Seçenek listesi: Model Y · Model 3 · Model S · Model X (dokunulabilir
  satırlar, form değil)

**Durumlar:** Tek durum — liste her zaman aynı şekilde gösterilir. Birden
fazla eksik bilgi varsa (MASTER_SPEC §6 Ekran 3: "Birden fazla soru
gerekiyorsa mümkün olduğunca tek tek sor") bu ekran **tek soruluk**
kalır ve bir sonraki soru ayrı bir `missing_info` state'i olarak
sıraya girer — asla tek ekranda birden fazla soru gösterilmez.

**Geçişler:** Seçim yapma → `preview_confirm`. (Geri: sağ üst ✕ veya
sistem geri hareketi → `understanding`'e döner.)

---

### 3.5 Önizleme / Onay (`preview_confirm`)

**Amaç:** Planı özetlemek ve kullanıcının **açık onayını** almak — bu
ekrandaki buton, AI Core'daki `ask_confirmation` + Safety Validator
zincirinin UI karşılığıdır (bkz. §2).

**İçerik:**

```
Hazır!

Tesla'dan ayrıldığında Sentry Mode açılacak.

🔵 Araç bağlantısı kesildiğinde
        ↓
🛡️ Sentry Mode aç

[ Otomasyonu Oluştur ]
```

**Durumlar:**
- `ready` — tüm izinler mevcut, buton aktif
- `missing_permission` — Permission Validator eksik izin bulduysa, buton
  üstünde küçük bir satır: "Bunun için Bluetooth iznine ihtiyacım var" +
  buton metni "İzin ver ve oluştur" olarak değişir (izin isteme, tam bu
  noktada, ihtiyaç anında — MASTER_SPEC §20)

**Geçişler:** Otomasyonu Oluştur → `setup`. Düzenle → `missing_info`
(varsa) veya `understanding`'e.

---

### 3.6 Kurulum

**Amaç:** Kurulumu tek dokunuşa mümkün olduğunca yaklaştırmak, ama
gerçekleşmeyen bir şeyi gerçekleşmiş gibi göstermemek.

**Neden bu model:** Üçüncü taraf bir uygulamanın kullanıcı adına tam bir
kişisel otomasyon kurabildiğine dair kanıt bulunamadı (bkz.
`docs/capabilities.md` §1.2). Bu yüzden "otomatik kurulum" ekranı
kaldırıldı. Ama **"otomatik kurulum yok" ≠ "kullanıcı 15 adım yapacak"**:
hedef tek dokunuş + Apple'ın kendi onay ekranı.

**Güncelleme (Phase 3B Test 1b/2, 2026-09-18, gerçek cihaz):** Gerçek
test, akışın iki ayrı elle-onay adımına ayrıldığını doğruladı: içe
aktarma (§3.6.b/c) ve otomasyon tetikleyicisini bağlama (§3.6.d, yeni).
"Tek dokunuş" hedefi kısmen tutuyor — her adımın KENDİSİ tek dokunuş
(şablonu seçmek, otomasyona eklemek), ama toplamda iki ayrı elle-onay
adımı var, tek değil. Bu, planın kendi "gerçekçi sonuç" öngörüsüyle
birebir örtüşüyor (`docs/phase3b-validation-plan.md` §"Sonuç matrisi").

#### 3.6.a `setup` — hazırlık

```
Otomasyonun hazırlanıyor

✓ Planlandı
✓ Doğrulandı
◐ Hazırlanıyor
```

Bu adımda plan doğrulanır ve kurulum paketi derlenir. **Kurulum
yapılmaz.** Hazırlık başarısız olursa doğrudan `setup_failed`.

#### 3.6.b `user_assisted_import` — kullanıcıya aktarma

```
Otomasyonun hazır 🎉

Arabadan ayrıldığında
🛡️ Tesla Sentry Mode'u açacak.

iPhone güvenlik nedeniyle son kurulumu senin onaylamanı istiyor.

[ Kestirmelere Ekle ]
```

Tek buton, tek dokunuş. Bu metin sabit değil: kurulum onayı uyarısı
registry'den türeyen `disclosures` listesinden geliyor
(`PROGRAMMATIC_AUTOMATION_INSTALL.possible !== true` olduğu sürece
ekleniyor). Apple ileride programatik kurulum sunarsa ve registry
güncellenirse, bu satır UI değişmeden kaybolur.

#### 3.6.c `waiting_for_user` — bilmediğimizi kabul etmek

```
Kestirmeler açıldı

Apple'ın ekranında onayladıktan sonra buraya dön. Kurulumun
gerçekleştiğini ben göremiyorum, o yüzden sana sormam gerekiyor.

[ Ekledim ]  [ Ekleyemedim ]
```

**Bu ekranın kritik özelliği: buradan otomatik ilerleme yoktur.**
Zamanlayıcı, tahmin veya iyimser varsayım yok. Uygulama kurulumun
gerçekleştiğini bilemez; bu yüzden sorar. Bu, testlerle sabitlenmiş bir
değişmez (`tests/install-model.test.ts`).

#### 3.6.d `linking_trigger` — Otomasyon Tetikleyicisini Bağla (Phase 3B Test 2 sonucuna göre eklendi, 2026-09-18)

**Neden bu ekran var:** Phase 3B Test 2 (`docs/phase3b-validation-plan.md`),
gerçek cihazda, içe aktarılan bir kestirmenin bir Personal Automation
tetikleyicisine (Bluetooth/CarPlay) **programatik olarak
bağlanamadığını** kanıtladı — kullanıcı bunu Shortcuts'ın kendi
Otomasyon sekmesinde elle yapmak zorunda. Ama aynı test, bunun düşük
sürtünmeli olduğunu da gösterdi: az önce eklenen kestirme, otomasyonun
eylemi olarak **tek dokunuşla** seçilebiliyor (yeniden kurulmuyor).

```
Son bir adım kaldı

Kestirmen eklendi. Şimdi iPhone'un otomasyon sekmesinde tetikleyiciyi
sen bağlamalısın — bunu iPhone güvenlik nedeniyle biz senin yerine
yapamıyoruz.

1. Kestirmeler'i aç → Otomasyon sekmesi → sağ üstten "+"
2. Tetikleyici olarak Bluetooth (bağlantı kesildiğinde) seç,
   aracını seç → İleri
3. Eylem olarak az önce eklediğin "Arabadan İnince Sentry Mode"
   kestirmesini seç — yeniden kurmana gerek yok, listeden tek
   dokunuşla eklenir
4. Bitir

[ Kestirmeler'i Aç ]

Bağladıktan sonra buraya dön:

[ Bağladım ]  [ Bağlayamadım ]
```

Adım adım metin (1-4), registry'deki capability'nin tetikleyici tipine
göre türetilir (Bluetooth/CarPlay/konum farklı adım metni üretir) —
Test 2'de kaydedilen gerçek Shortcuts akışı temel alınır, uydurulmaz.
"Kestirmeler'i Aç" düz `shortcuts://` (parametresiz) ile uygulamayı açan
bir kolaylık butonu; otomasyon oluşturma ekranına doğrudan atlayan bir
deep link **yok** (Test 2'de aranmadı, bilinen bir mekanizma değil).

**Bu ekran de aynı değişmeze uyar: buradan da otomatik ilerleme yoktur**
— `waiting_for_user` ile aynı prensip, aynı sebep (MASTER_SPEC §18).
"Bağlayamadım" → `setup_failed`.

**Kod tarafı — henüz yapılmadı:** Bu, `BuilderStep` union'ına (TS:
`src/builder/types.ts`, Swift: `BuilderStep.swift`) yeni bir
`linking_trigger` durumu eklenmesini ve `installed`'a girme koşulunun
("Ekledim" yeterliydi) artık "Ekledim" **VE** "Bağladım" ikisini de
gerektirecek şekilde genişletilmesini gerektiriyor. State machine
mimarisi buna hazır (bkz. `docs/ios-bridge.md` §5) ama implementasyon
henüz yapılmadı — bu bir sonraki, ayrı bir karar/iş.

#### 3.6.e `setup_failed`

```
Kurulum tamamlanamadı

[ Tekrar dene ]  [ Sonra devam ederim ]
```

Otomasyon **kaydedilmez**. "Tekrar dene" `setup`'a döner. Artık iki
farklı başarısızlık kaynağı olabilir: içe aktarma ("Ekleyemedim") veya
tetikleyici bağlama ("Bağlayamadım") — `reason` alanı hangisi olduğunu
ayırt eder.

### 3.7 `installed` → `success`

```
✅
Otomasyonun hazır

Artık bunu telefonunun otomasyonlarından kullanabilirsin.

[ Devam ]
```

`installed`, otomasyonun `installStatus: "installed"` ile kaydedildiği
andır. **Güncellendi (Phase 3B Test 2, 2026-09-18):** buraya girmenin
tek yolu artık yalnızca "Ekledim" değil — kullanıcının hem "Ekledim"
(§3.6.c) hem de "Bağladım" (§3.6.d, yeni `linking_trigger` adımı)
demesidir. Kod tarafında bu henüz uygulanmadı (bkz. §3.6.d'nin "Kod
tarafı" notu); bu satır, kodun hedef davranışını tarif ediyor.
`success` ise sadece kutlama/kapanış ekranı; `installed` dışından
erişilemez.

**Domain karşılığı:** `Automation.installStatus` üç değer alır:
`pending_user | installed | failed`. Bu ayrım Activity/Execution tarafı
için şart: "Kestirmeler'e gönderdim" ile "kestirme gerçekten kuruldu"
farkı listede rozet olarak da görünür (§4).

## 4. Otomasyonlarım (en önemli ekran)

**Amaç:** Kullanıcı uygulamayı her açtığında karşılaşacağı, hiçbir
workflow terminolojisi içermeyen basit liste.

**İçerik — her kart:**
```
🚗 Tesla
Arabadan ayrılınca
Sentry Mode → [Açık/Kapalı anahtarı]
```

- Emoji: otomasyonun ait olduğu kategori (§3.1'deki 6 kategoriyle
  tutarlı)
- Satır 2: tetikleyicinin sade dili (**asla** "trigger" kelimesi yok)
- Satır 3 + anahtar: eylem adı + büyük Aç/Kapat anahtarı (dokunma alanı
  en az 44×44pt — §19 "büyük dokunma alanları")
- Kurulum durumuna göre rozet: `pending_user` → **"Kurulum bekliyor"**,
  `failed` → **"Kurulamadı"**, elle kurulan otomasyonlarda → **"Manuel
  adım gerekli"**. Kurulumu doğrulanmış otomasyonlarda rozet yok.

**Kart dokunma:** Detay ekranına gider — Tetik / Eylem / Onay özetleri +
"Son çalıştırmalar" (Aktivite'nin o otomasyona filtrelenmiş hali).

**Boş durum:** Hiç otomasyon yoksa, liste yerine tek bir davet: "Henüz
otomasyonun yok. Ana sayfadan başlayabilirsin." + Ana Sayfa'ya kısayol
buton. (§19: "Boş ekran, harekete geçme davetidir.")

---

## 5. İkincil ekranlar (kısa spesifikasyon)

Bunlar Phase 1 prototipinde büyük ölçüde tanımlı; burada sadece
değişen/netleşen noktalar not ediliyor.

- **Şablonlar:** Kategori filtresi + şablon listesi. Her şablon satırı,
  dokunulduğunda doğrudan `understanding` state'inden başlar (kendi
  `capturing` adımı atlanır, çünkü metin zaten biliniyor).
- **Aktivite:** Tüm otomasyonların çalıştırma geçmişi, en yeni üstte.
  Durum ikonu üç değerden biri: ✅ başarılı, ⚠️ manuel adım bekleniyor,
  ❌ hata (+ "Tekrar dene" linki). Asla dördüncü bir "belirsiz" durum
  yok — her execution bu üç kategoriden birine düşmeli (Execution domain
  modelindeki `status` alanıyla birebir: `succeeded | pending +
  requires_guided_setup | failed`).
- **Ayarlar:** Hesap · Bildirimler · İzinler · Gizlilik ve veri ·
  Hakkında. Phase 1'de hepsi placeholder; gerçek içerik Phase 3'te
  (izin durumları gerçek OS API'lerinden okunduğunda) doldurulur.

---

## 6. SwiftUI implementasyonu için iskelet notları

**Not:** Bu, Phase 3 (iOS MVP) için hazırlık amaçlıdır — CLAUDE.md
sırasına göre bu fazın kodlanması Phase 2 (Intent/Entity Extraction)
bitmeden **başlamamalı**. Aşağıdaki notlar sadece mimari hazırlık.

### 6.1 Önerilen dosya/modül eşlemesi (MASTER_SPEC §9 ile uyumlu)

```
Features/
├── Home/
│   ├── HomeView.swift
│   └── HomeViewModel.swift
├── Builder/
│   ├── BuilderFlowView.swift        ← modal container, state machine host
│   ├── BuilderViewModel.swift       ← §1.2'deki state machine burada yaşar
│   ├── CapturingStepView.swift
│   ├── UnderstandingStepView.swift
│   ├── MissingInfoStepView.swift
│   ├── PreviewConfirmStepView.swift
│   ├── SetupStepView.swift          ← native/guided iki alt-view içerir
│   └── SuccessStepView.swift
├── Automations/
│   ├── AutomationsListView.swift
│   └── AutomationDetailView.swift
├── Templates/
├── Activity/
└── Settings/
```

### 6.2 State machine tipi

```swift
enum BuilderStep: Equatable {
    case capturing
    case understanding(plan: DraftAutomationPlan)
    case missingInfo(question: MissingInfoQuestion)
    case previewConfirm(plan: DraftAutomationPlan)
    case setup(SetupKind)
    case success(Automation)
}

enum SetupKind: Equatable {
    case native
    case guided(steps: [String])
}
```

`BuilderViewModel: ObservableObject`, `@Published var step: BuilderStep`.
Geçişler yalnızca ViewModel içindeki fonksiyonlarla yapılır (View'lar
state'i doğrudan değiştirmez) — bu, §1.2'deki state machine'i test
edilebilir kılar (CLAUDE.md: "Her capability için unit/integration test
yaz" ilkesi, state machine geçişleri için de geçerli).

### 6.3 AI Core paketiyle ilişki

`DraftAutomationPlan`, TypeScript tarafındaki `AutomationPlan` şemasının
Swift karşılığıdır (aynı alanlar: `name`, `trigger`, `steps`). İki tarafın
**aynı JSON şeklini** ürettiğinden emin olmak için, backend/AI servisi
tarafında üretilen JSON, doğrudan zaten yazılmış olan
`packages/automation-dsl` şemasıyla doğrulanmalı — Swift tarafı bu JSON'u
sadece render eder, kendi validasyon mantığını **tekrar yazmaz** (tek
kaynak: TypeScript AI Core).

---

## 7. Kapatılmış kararlar (eski "açık sorular")

Bu dört madde ürün kararı olarak netleşti. Phase 2'nin NLU tasarımı bu
kararlara uymak zorundadır.

### 7.1 AI yanlış anladıysa: revize, sıfırlama değil

**✎ Değiştir**, kullanıcıyı boş bir ekrana geri atmaz. Kullanıcı doğal
dille düzeltmesini yazar/söyler:

> "Kamera değil, Sentry Mode'u aç."

AI mevcut planı **siler değil, revize eder** — yani `capturing`'e
dönülürken taslak plan korunur ve düzeltme metni plana **delta** olarak
uygulanır. State machine karşılığı: `understanding --revise-->
capturing(withDraft: currentPlan)`. Mevcut plan korunduğu için, kullanıcı
sadece değişen parçayı söyler; baştan anlatmak zorunda kalmaz.

### 7.2 AI hiçbir şey anlayamadıysa

`capturing` ekranında yeni bir durum: `not_understood`.

> "Bunu tam anlayamadım. Ne yapmak istediğini biraz daha anlatır mısın?"

Altında dokunulabilir örnekler (dokunma → metin alanını doldurur):

- "Arabadan inince…"
- "Eve gelince…"
- "Saat 21'de…"

Bu bir hata ekranı değil, aynı ekranın bir durumu — kullanıcı akıştan
atılmaz, girdiği metin de silinmez.

### 7.3 Desteklenmeyen capability

Capability Validator `unknown_capability` döndürürse (AI, registry'de
olmayan bir şey üretmişse) `understanding` yerine `unsupported` state'i
gösterilir:

> "Bunu şu anda otomatik olarak yapamıyorum."
>
> "İstersen desteklenen başka bir yöntem deneyebiliriz."

İkinci satır bir buton: dokunma → `capturing`'e döner (§7.1'deki gibi
taslak korunarak). Asla çıkmaz sokak bırakılmaz ve asla "yapıldı"
denmez.

**Not — iki farklı durumu karıştırmamak gerekir:**
`unknown_capability` (registry'de hiç yok → §7.3, akış durur) ile
`requires_guided_setup` (registry'de var ama `nativeSupport: false` →
§3.6.b, akış devam eder, guided setup gösterilir) **farklı** şeylerdir.
Kamera senaryosu ikincisidir, birincisi değil.

### 7.4 Birden fazla eksik bilgi: öncelik sırası

Sorular her zaman tek tek sorulur (§3.4) ve şu sırayla:

1. **Tetikleyici** — otomasyon ne zaman çalışacak?
2. **Cihaz / kişi** — hangi araç, hangi kişi, hangi oda?
3. **Eylem detayı** — tam olarak ne yapılacak?
4. **Opsiyonel tercihler** — en son, ve atlanabilir olmalı.

Bir kategoride birden fazla eksik varsa, o kategori içinde plandaki
görülme sırası kullanılır. Opsiyonel tercihler (4. seviye) için kullanıcı
"Şimdilik geç" diyebilmelidir — zorunlu soru hissi yaratılmamalı.

**Test edilebilirlik:** Bu sıralama, state machine'de saf bir fonksiyon
olarak implemente edilir (`nextMissingInfoQuestion(plan) -> Question?`),
böylece öncelik kuralı UI'dan bağımsız unit test edilebilir.

