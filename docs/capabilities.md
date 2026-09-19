# Capability Matrix + Compiler Contract (Phase 1.5)

Bu doküman, `src/capability-registry/` ve `src/compiler/contract.ts`
içindeki makine-okunabilir matrisin insan tarafını açıklar. Matrisin
kendisi koddadır; bu dosya **neden öyle olduğunu** anlatır.

---

## 1. İki düzeltme (önce bunlar okunmalı)

### 1.1 Bluetooth hakkında verdiğim bilgi eksikti

Phase 1'in sonunda "iOS, Bluetooth tetikleyicili otomasyonları asla
sessizce çalıştırmaz" dedim ve buna dayanarak bir ürün kararı sordum.
**Bu bilgi Apple'ın iOS 15 dokümanından geliyordu.**

iOS 26 dokümanında liste değişmiş: Bluetooth artık *onaysız
çalıştırılabilen* otomasyonlar arasında. iOS 26'da onaysız
çalıştırılamayan **tek** tetikleyici "Before I Commute".

| Tetikleyici | iOS 15 | iOS 26 |
|---|---|---|
| Bluetooth | onay zorunlu | onaysız çalışabilir |
| Wi-Fi | onay zorunlu | onaysız çalışabilir |
| Arrive / Leave | onay zorunlu | onaysız çalışabilir |
| Mesaj / E-posta | onay zorunlu | onaysız çalışabilir |
| CarPlay | onaysız çalışabilir | onaysız çalışabilir |
| Time of Day | onaysız çalışabilir | onaysız çalışabilir |
| Before I Commute | onay zorunlu | onay zorunlu |

iOS 16, 17 ve 18 sürümlerini **doğrulamadım**. Registry bu yüzden
iOS 15 davranışını 16–25 aralığı için geçerli kabul ediyor; yani
muhafazakâr taraftan yanılıyor ("belki onay sorar" diyor). Bu aralığın
doğrulanması `docs/capabilities.md` açık işlerinde.

**Güncelleme (2026-09-18, gerçek iPhone 16 Pro, iOS 26 — Phase 3B
Test 3):** iOS 26 satırındaki Bluetooth davranışı artık `apple_docs`
değil, **gerçek cihaz kanıtı**: elle kurulan bir Bluetooth-disconnect
otomasyonu, cihazın Bluetooth bağlantısı gerçekten kesildiğinde onay
istemeden çalıştı. iOS 16/17/18 boşluğu hâlâ açık.

**Bunun ürün sonucu:** "iki onay" problemi iOS 26'da yok, eski
sürümlerde olabilir. Yani senin üç seviyeli yaklaşımın hâlâ doğru ama
gerekçesi değişti: Bluetooth'u CarPlay'e tercih etmemenin sebebi artık
"onay zorunluluğu" değil, sadece kapsam genişliği.

### 1.2 Asıl kısıt onay değil, kurulum

Daha önemli bulgu: **üçüncü taraf bir uygulamanın kullanıcı adına tam
bir kişisel otomasyon (tetikleyici + eylem) kurabildiğine dair bir kanıt
bulamadım.** Apple geliştirici forumlarında geliştiriciler tam bunu
soruyor ve programatik yol bulamadıklarını bildiriyor; önerilen yol
App Intents ile eylem sunmak ve otomasyonu kullanıcının kendisinin
kurması.

Kanıt seviyesi (başlangıçta): **ikincil** (geliştirici forumu, Apple
dokümanı değil). Bu yüzden registry `possible: "unverified"` diyordu —
ama sözleşme, tersini varsaymayı yasaklıyordu.

**Güncelleme (2026-09-18, gerçek iPhone 16 Pro, iOS 26):** Bu artık
ikincil kaynak değil, **gerçek cihaz testiyle doğrulanmış bir kısıt.**
Phase 3B Test 1 (`docs/phase3b-validation-plan.md`), sıfırdan üretilmiş
(Apple/iCloud tarafından imzalanmamış) bir `.shortcut` dosyasının,
`shortcuts://import-shortcut` dahil hiçbir yoldan içe aktarılamadığını
gösterdi — iOS'un kendi hata mesajı: *"Importing unsigned shortcut
files is not supported."* Yani üçüncü taraf bir uygulama (bizim
uygulamamız dahil) çalışma zamanında bir shortcut dosyası **üretip**
kullanıcıya **doğrudan verme** yeteneğine sahip değil; bu kod tarafında
bir eksiklik değil, iOS'un platform seviyesinde bir kısıtı.

Not: Bu sonuç `shortcuts://import-shortcut` mekanizmasının kendisini
geçersiz kılmıyor (URL tanınıyor, işleniyor) — yalnızca *imzasız*
içeriği reddediyor.

**Açık soru kapatıldı (Test 1b, aynı gün):** Apple'ın kendi imzaladığı,
önceden Shortcuts uygulamasında elle hazırlanmış bir şablon, düz bir
iCloud paylaşım linki (Universal Link, Safari üzerinden) açıldığında
**başarıyla içe aktarıldı, kütüphaneye eklendi ve çalıştırıldı.**
Yani `user_assisted_import` tamamen elenmiyor, ama kapsamı daralıyor:

> AI çalışma zamanında özgün/rastgele bir `.shortcut` dosyası
> **üretip doğrudan veremez.** Ama **önceden Shortcuts uygulamasında
> elle hazırlanmış ve Apple/iCloud tarafından imzalanmış bir şablon
> kütüphanesinden** seçip iCloud linkiyle kullanıcıya sunabilir; AI'ın
> rolü bu şablonlardan hangisinin uygun olduğunu seçmek ve (mümkünse)
> parametrelerini kullanıcı niyetine göre önceden doldurmak olur, sıfırdan
> eylem dizisi üretmek değil.

Bu, `InstallMethod` enum'ında (`src/capability-registry/types.ts`)
`automatic` ile `guided_manual` arasında üçüncü, daha spesifik bir
kategori gerektirip gerektirmediği sorusunu açıyor (örn.
`user_assisted_import_template`) — bu bir isimlendirme/kapsam kararı,
henüz koda işlenmedi.

**Bunun ürün sonucu:** Phase 1 UX'indeki "native otomatik kurulum"
ekranı (docs/ux.md §3.6.a — "Harika! Otomasyon telefonuna kuruluyor")
büyük olasılıkla **hiçbir capability için gerçekleşemez.** Gerçekçi en
iyi senaryo: uygulama otomasyonu hazırlar, kullanıcı tek dokunuşla içe
alır/onaylar (`user_assisted_import`).

Bu bir ürün kararı gerektiriyor ve UX'i tek taraflı değiştirmedim:
ya §3.6.a ekranını "hazırladım, şunu onayla" şekline çeviririz, ya da
Phase 3'te bu kısıt resmi olarak doğrulanana kadar iki ekranı da
koruyup `automatic`'i asla üretmeyiz (şu anki durum: kod
`automatic` üretemiyor, sözleşme testi engelliyor).

---

## 2. Matrisin alanları

Her capability için sorulan sorular ve karşılık gelen alanlar:

| Soru | Alan |
|---|---|
| Native destekliyor mu? | `nativeSupport` |
| Shortcuts'ta var mı? | `availableInShortcuts` |
| Bizim App Intent'imizle yapılabilir mi? | `appIntentCapable` |
| Otomatik çalışıyor mu / iOS onay istiyor mu? | `behaviors[].canRunWithoutAsking` (sürüm sürüm) |
| Hangi izin gerekiyor? | `permissions[]` |
| Kurulum nasıl yapılıyor? | `installMethod` |
| Kullanıcı manuel adım yapmak zorunda mı? | `requiresUserSetupStep`, `fallbackSteps[]` |
| Kullanıcıya önceden ne söylenmeli? | `userDisclosures[]` |
| Ne kadar güveniyoruz? | `evidence` + `source` + `verifiedAt` |

### Üç değerli mantık

`Tristate = true | false | "unverified"`. Bilmediğimizi `false` diye
kaydetmek yasak — çünkü `false`, "Apple bunu desteklemiyor" demek;
`"unverified"` ise "biz bakmadık" demek. İkisi çok farklı ürün kararına
yol açar. Örnek: Focus tetikleyicisi Apple'ın iki listesinin de hiçbirinde
geçmiyor, bu yüzden `"unverified"`.

### Kanıt seviyeleri

- `apple_docs` — Apple'ın kendi dokümanı
- `vendor_docs` — üretici (Tesla) resmi kaynağı
- `secondary` — haber/forum, teyit bekliyor
- `unverified` — hiç doğrulanmadı

Ürün kararları yalnızca `apple_docs` / `vendor_docs` satırlarına
dayanmalı. `secondary` satırlar Phase 3'te teyit edilmeli.

---

## 3. Capability resolver (üç seviyeli araç yaklaşımı)

```
Kullanıcı niyeti: "arabadan inince"
        ↓
triggerGroup: "vehicle_departure"
        ↓
CarPlay mevcut? ──Evet──▶ ios.carplay.disconnected   (priority 1)
        │
       Hayır
        ↓
ios.bluetooth.disconnected                            (priority 2)
        ↓ (kullanıcı açıkça isterse)
ios.location.leave                                    (priority 3)
```

Öncelik kodda değil registry'de (`priority` alanı). Apple yeni bir
tetikleyici sunduğunda UX'e veya AI'a dokunmadan sadece yeni satır
eklenip priority'si ayarlanır.

Konum tabanlı alternatif **bilinçli olarak eşdeğer sayılmıyor**: farklı
izin (`location_always`) ister, aracı değil telefonu takip eder ve
yalnızca kullanıcı açıkça seçerse devreye girer
(`prefersLocationTrigger`). Bu, resolver testlerinde sabitlenmiş.

### Disclosure üretimi

`disclosuresFor(capability, deviceContext)` kullanıcıya kurulumdan önce
söylenecekleri üretir. iOS'un ek onay soracağı bir durumda şu satır
otomatik ekleniyor:

> "Bu otomasyon her çalıştığında iPhone sana ayrıca onay soracak; bu
> iOS'un kendi davranışı ve kapatılamıyor."

Yani "iki onay çıkması sürpriz olmasın" kuralı bir UI metni değil,
registry'den türetilen bir çıktı. Cihaz iOS 26 ise bu satır hiç
üretilmiyor — gereksiz korkutma yapılmıyor.

---

## 4. Compiler Contract

`src/compiler/contract.ts` compiler'ı implemente etmez; **ne üretmek
zorunda olduğunu** tanımlar:

- Çıktı: `ShortcutsAutomationArtifact` (tetikleyici + eylemler +
  `askBeforeRunning` durumu) veya `GuidedManualArtifact` (neden + adımlar)
- `installMethod`: `automatic | user_assisted_import | guided_manual |
  app_intent_exposure`
- `claimsInstalled: false` — **compiler asla "kuruldu" diyemez.** Kurulum
  sonucu ayrı bir kanaldan bildirilir (MASTER_SPEC §18).

### Sözleşme testleri registry'yi denetliyor

`checkRegistryContract()` şu kuralları zorluyor:

1. `nativeSupport: false` olan her satır `guided_manual` + dolu
   `fallbackSteps` taşımak zorunda
2. Programatik kurulum doğrulanmadıkça hiçbir satır `automatic` olamaz
3. Her satır kaynak + `YYYY-MM-DD` formatında doğrulama tarihi taşımalı
4. Native destekli her satır en az bir `OSBehavior` taşımalı
5. `behaviors` artan sürüm sırasında ve kaynaklı olmalı
6. Doğrulanmamış davranış bir `note` ile açıklanmalı
7. iOS'un onay soracağı tetikleyiciler disclosure taşımalı
8. Aynı grupta priority çakışamaz

Bu testleri yazarken kendi registry'imde 3 ihlal çıktı (Wi-Fi'da eksik
disclosure, iki Tesla eyleminde açıklanmamış belirsizlik) ve düzeltildi.
Sözleşmenin işe yaradığının kanıtı bu.

---

## 5. Açık işler

1. **iOS 16/17/18 doğrulaması** — Bluetooth/Wi-Fi/Mesaj davranışının hangi
   sürümde değiştiği bilinmiyor. Şu an muhafazakâr varsayım yapılıyor.
2. **Programatik kurulum** (§1.2) — 2026-09-18'de gerçek cihazda
   tamamen teyit edildi (Test 1 + Test 1b): sıfırdan/imzasız shortcut
   üretimi çalışmıyor, Apple-imzalı önceden hazırlanmış şablon
   (iCloud linki) çalışıyor. Kalan iş: bu ayrımı `InstallMethod`
   enum'ına ve `docs/ux.md`'ye işlemek (ürün kararı, henüz yapılmadı).
3. **Focus tetikleyicisi** — Apple'ın hiçbir listesinde geçmiyor.
4. **Tesla eylemlerinin "otomatik çalıştır" desteği** — 2026-09-19'da
   gerçek Tesla + iPhone 16 Pro ile teyit edildi (Phase 3B Test 5):
   "Nöbetçi Modu" (Sentry Mode) eylemi, parametresi sabit bir değere
   ayarlandığında hem tek başına hem de bir Bluetooth-disconnect
   otomasyonu içinde **onay istemeden** çalıştı ve aracı gerçekten
   etkiledi (Tesla uygulamasından doğrulandı). **Yeni bulunan kısıt:**
   eylemin parametresi "Her Seferinde Sor" bırakılırsa (sabitlenmezse),
   otomasyon içinde bile interaktif olarak sorar — yani AI/compiler'ın
   ürettiği her parametreli eylem somut bir değerle bağlanmak zorunda.
   **Kodlandı (Phase 3C-1, 2026-09-19):** `Capability.parameters` +
   `capability-validator.ts` bunu makine tarafından doğrulanan bir
   sözleşmeye çevirdi — eksik/geçersiz parametreli bir eylem artık
   reddediliyor (`missing_required_parameter`/`invalid_parameter_value`).
   Tesla'nın gerçek şeması: `mode: enum, allowed: ["enable","disable"]`.
5. **Tesla kaynağı** — 2026-09-19'da `secondary`'den gerçek cihaz
   kanıtına yükseltildi (yukarıdaki madde). Resmi Tesla dokümanı/release
   notu hâlâ bulunmadı; `evidence: "vendor_docs"` için bu ayrıca gerekli
   olabilir ama artık ürün kararları için gerçek cihaz kanıtı yeterli.
6. **WhatsApp** — MASTER_SPEC §22'de geçiyor ama Shortcuts'ta böyle bir
   tetikleyici doğrulanmadı; matrise hiç eklenmedi (tahmin yapmamak için).
7. **Şablon içeriği eksik (Phase 3C-2, 2026-09-19) — İÇERİK BOŞLUĞU,
   KOD EKSİKLİĞİ DEĞİL:** `Capability.template` alanı ve onu okuyan
   gerçek `TemplateBackedSetupService` (Swift) yazıldı, ama registry'deki
   15 capability'nin HİÇBİRİNDE gerçek bir Apple/iCloud şablonu yok.
   Birinin Shortcuts uygulamasında her eylem (Tesla Sentry Mode dahil)
   için elle bir şablon oluşturup "iCloud Bağlantısını Kopyala" ile
   aldığı linki registry'ye eklemesi gerekiyor. O yapılana kadar gerçek
   `SetupService` her plan için dürüstçe `.noTemplateAvailable` döner —
   bu bir hata değil, MASTER_SPEC §18'in gerektirdiği dürüstlük.
