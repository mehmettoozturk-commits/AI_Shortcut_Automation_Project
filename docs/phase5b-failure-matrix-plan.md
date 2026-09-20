# Phase 5B — Failure Matrix Validation Plan

Phase 5A, sistemin **başarı yolunu** gerçek cihazda kanıtladı (metin
girişinden `installed`/`success`'e kadar, hem rule-based hem gerçek
NVIDIA ile). Phase 5B'nin amacı bunun aynası: sistemin **başarısız
olduğunda dürüst davranıp davranmadığını** kanıtlamak.

**Her satır için sorulan 4 soru (kabul kriteri):**

```text
Kullanıcıya ne gösteriliyor?
        ↓
State ne oluyor?
        ↓
Repository'ye ne yazılıyor?
        ↓
Yanlışlıkla `installed` oluyor mu?
```

Son soru release açısından kritik: bu matrisin HERHANGİ bir satırında
cevap "evet, yanlışlıkla installed oluyor" ise bu **P0, release'i
durduran** bir bulgudur.

---

## Ön analiz — bu matrisin ne kadarı zaten otomatik testlerle kapalı

Phase 5B'ye "sıfırdan" başlamıyoruz. Aşağıdaki tarama (bu round'da
yapıldı, kod OKUNDU, tahmin edilmedi) çoğu satırın TS/Swift birim
testleriyle ZATEN kapalı olduğunu gösteriyor. Phase 5B'nin gerçek işi:
(a) bu kapsamı bir kez doğrulamak (testler hâlâ yeşil mi), (b)
GERÇEKTEN eksik olan satırları (çoğunlukla gerçek cihaz/manuel
doğrulama gerektirenler) belirlemek, (c) hepsini TEK bir matriste
toplamak.

| Kategori | Durum | Zaten kapsayan test(ler) |
|---|---|---|
| Provider: timeout | ✅ otomatik | `HTTPBackedPlannerTests.testNetworkTimeout_mapsToPlannerUnreachable` |
| Provider: network unreachable | ✅ otomatik | aynı test (network hatası → `.plannerUnreachable` → `.notUnderstood`) |
| Provider: provider_error (502) | ✅ otomatik | `HTTPBackedPlannerTests.testE_providerErrorSurfacesAsDistinctDomainStateNotGenericFailure`, `provider-retry.test.ts` (6 test, retry/repair zinciri) |
| Provider: malformed response | ✅ otomatik | `provider-retry.test.ts`: prefix sızıntısı, eksik eylem, şema hatası, "hâlâ malformed → provider_error (yalnızca 2 çağrı)" |
| Planning: not_understood | ✅ otomatik | çok sayıda test (TS `nlu.test.ts`, Swift `HTTPBackedPlannerTests`) |
| Planning: unsupported | ✅ otomatik | `HTTPBackedPlannerTests.testD_unsupportedFlowsThroughBuilderMachineAsUnsupportedStep`, `provider-retry.test.ts` ("registry'de desteklenmeyen: retry YOK, doğrudan unsupported") |
| Planning: missing information | ✅ otomatik | `HTTPBackedPlannerTests.testB_...`, `builder-machine.test.ts` (§7.4 çok sayıda test) |
| Planning: invalid semantic | ✅ otomatik | `semantic-completeness.test.ts` (Phase 4E-1) |
| Setup: no template | ✅ otomatik | `TemplateBackedSetupServiceTests.testNoTemplateAvailable_forRealCapabilitiesToday` (Phase 5A İş 0.5'te tekrar doğrulandı) |
| Setup: Shortcuts open failure | ✅ otomatik | `BuilderMachineTests.testHandOffToShortcutsFailure_whenOSCannotOpenURL` |
| Setup: "Bağlayamadım" | ✅ otomatik | `BuilderMachineTests.testReportInstallFailed_fromLinkingTrigger` |
| Setup: "Ekledim" dedi ama GERÇEKTEN import olmadı | ❌ **test EDİLEMEZ** | Bkz. not altta — bu bir failure modu değil, kasıtlı bir tasarım sınırı |
| Persistence: `pending_user`/`failed`/`installed` restart sonrası | ✅ otomatik + gerçek cihaz | `FileBackedAutomationRepositoryTests.testPendingOrFailedRecord_isNotSilentlyRestoredAsInstalled`, Phase 5A Test 3 (gerçek cihaz) |
| User flow: revise | ✅ otomatik | `builder-machine.test.ts` §7.1, Phase 5A Test 5 (gerçek cihaz) |
| User flow: cancel/close | ✅ otomatik | `builder-machine.test.ts`: "close(): her yerden idle'a döner ve hiçbir şey kaydetmez" |
| User flow: yanlış state'den tekrarlanan/erken onay | ✅ otomatik | `builder-machine.test.ts`: "Bağladım ama Ekledim yok: YOK SAYILIR", "confirmGuidedSetupDone(): yanlış state'den YOK SAYILIR", "confirmTriggerLinked() yanlış state'lerden YOK SAYILIR" — TAM OLARAK "yanlışlıkla installed olur mu" sorusunun testi |

**"Ekledim dedi ama gerçekten import olmadı" neden test edilemez:**
Bu, Phase 3B Test 7'nin kanıtladığı bir platform gerçeği —
`shortcuts://import-shortcut`'ın sonucu (kullanıcı gerçekten
"Ekle"ye bastı mı) iOS tarafından uygulamaya HİÇ bildirilmiyor. Bu
yüzden ürün BİLEREK "Ekledim" butonunu kullanıcının kendi beyanına
dayandırıyor (bkz. `ShortcutsHandoff.swift`, `BuilderStep.swift`
yorumları). Bu bir test edilecek "failure" değil, kasıtlı bir tasarım
sınırı — Phase 5B bunu bir gap olarak İŞARETLEMEZ, yalnızca dokümante
eder.

**Sonuç:** Matrisin ~15 satırından 14'ü zaten otomatik testlerle kapalı
(veya test edilemez olduğu bilinçli olarak belgelenmiş). Phase 5B'nin
gerçek, YENİ işi şunlardan ibaret:

1. Yukarıdaki testlerin HÂLÂ yeşil olduğunu bir kez topluca doğrulamak
   (regresyon taraması — bkz. Test 5B-1).
2. Phase 5A'nın bulduğu, HENÜZ test edilmemiş iki gerçek gap'i
   kapsama almak: **istemci timeout'u** (Test 6 bulgusu) ve
   **conversation context leakage** (Test 5 bulgusu) — bunlar için
   YENİ, deterministik testler yazmak (bkz. Test 5B-2, 5B-3).
3. Gerçek cihazda, otomatik testlerin ULAŞAMADIĞI iki senaryoyu
   fiziksel olarak doğrulamak: gerçek network kaybı (uçak modu) ve
   gerçek Shortcuts'ı reddetme/geri gitme (bkz. Test 5B-4, 5B-5).

---

## Testler

### Test 5B-1 — Mevcut failure-path regresyon taraması (P0)

**Ne:** Yukarıdaki tabloda "✅ otomatik" işaretli TÜM testleri bir kerede
çalıştır, hepsinin hâlâ yeşil olduğunu doğrula. Yeni kod YAZILMIYOR —
yalnızca `npm test` + `swift test` + gerçek Xcode UI regression.

**Kabul kriteri:** Tümü yeşil. Kırmızı çıkan olursa, o satır Phase 5B'de
"regresyon" olarak işaretlenir ve ayrı ele alınır (Phase 5B'nin kapsamı
YENİ testler değil, mevcutları doğrulamaktır — bir regresyon bulunursa
bu ayrı, acil bir konu olur).

---

### Test 5B-1 SONUÇ (beklemede)

---

### Test 5B-2 — İstemci timeout'u yoksa gerçekten ne oluyor (P0, YENİ deterministik test)

**Sorulan soru:** Phase 5A Test 6'da gözlemlenen "gerçek LLM 100+
saniye sürebiliyor, istemci timeout'u yok" bulgusu — bunun SONUCU tam
olarak ne? Kullanıcı sonsuza kadar mı bekliyor, yoksa bir noktada
(URLSession'ın varsayılan `timeoutIntervalForRequest`'i, tipik 60sn)
gerçekten `.notUnderstood`'a mı düşüyor?

**Yöntem:** Gerçek cihaz GEREKMİYOR — sahte, kontrollü bir gecikmeli
`PlanHTTPTransport` (test double) ile deterministik bir Swift testi:
70+ saniye gecikmeli bir transport enjekte edip `HTTPBackedPlanner.plan()`
çağrısının ne döndürdüğünü ve ne kadar sürdüğünü ölçmek.

**4 soru:**
- Kullanıcıya ne gösteriliyor? → (ölçülecek: "Anlayamadım" mı, sonsuz
  bekleme mi)
- State ne oluyor? → `.capturing(notUnderstood: true)` bekleniyor.
- Repository'ye ne yazılıyor? → Bu aşamada henüz `create()` çağrılmadı,
  hiçbir şey yazılmamalı.
- Yanlışlıkla installed oluyor mu? → Hayır olmalı.

**Kabul kriteri:** Davranış NET olarak belgelenir (bekleme süresi +
sonuç). Eğer gerçekten kullanıcıyı süresiz bekletiyorsa, bu **P0 UX
bug'ı** olarak yükseltilir (explicit timeout + kullanıcıya "düşünülüyor"
göstergesi gerekir) — ama önce GERÇEKTEN ne olduğu ölçülmeli, tahmin
edilmemeli.

---

### Test 5B-2 SONUÇ (beklemede)

---

### Test 5B-3 — Conversation context leakage'ın kapsamı (P1, YENİ deterministik test)

**Sorulan soru:** Phase 5A Test 5'te ampirik olarak gözlemlenen
"`close()`/`open()` planner konuşma bağlamını sıfırlamıyor" bulgusu —
bunun TAM olarak hangi senaryoları etkilediği deterministik bir testle
belgelenmeli (yalnızca "bir kez gözlemlendi" değil).

**Yöntem:** Sahte bir `Planner` (test double, `conversation` state'ini
görünür tutan) ile: (1) bir otomasyonu `missingInfo`'ya kadar götür,
`answerMissingInfo` ile cevapla, (2) `close()` çağır, (3) YENİ, alakasız
bir `open()` + `submit()` yap, (4) yeni denemenin cevaplarının/
`draft.answers`'ının BOŞ başladığını doğrula (bugün başlamıyor —
bu test'in BEKLENEN sonucu FAIL olacak, bu bilinçli: bulguyu
ölçülebilir/tekrarlanabilir kılmak).

**4 soru:**
- Kullanıcıya ne gösteriliyor? → Soru atlanıp yanlış/eski bir cevapla
  doğrudan preview'e gidebilir (yanıltıcı).
- State ne oluyor? → `.missingInfo` atlanıp `.previewConfirm`'e geçebilir.
- Repository'ye ne yazılıyor? → `create()`'e kadar gidilirse, ESKİ
  cevapla (örn. yanlış araç) bir `pendingUser` kaydı oluşabilir.
- Yanlışlıkla installed oluyor mu? → Kullanıcı fark etmeden "Bağladım"
  derse EVET — yanlış bir otomasyon `installed` olabilir. **Bu satır
  potansiyel olarak P0'a yükselebilir**, test bunu netleştirecek.

**Kabul kriteri:** Bu test YAZILIR ve mevcut (henüz düzeltilmemiş)
davranışı KANITLAR — Phase 5B'de kod DEĞİŞTİRİLMEZ, yalnızca bulgu
ölçülür ve backlog'a kesin bir tekrarlanabilir test olarak eklenir.

---

### Test 5B-3 SONUÇ (beklemede)

---

### Test 5B-4 — Gerçek network kaybı, gerçek cihaz (P1)

**Sorulan soru:** Uçak modu / gerçek Wi-Fi kaybı sırasında bir plan
isteği gönderilirse, otomatik testlerin simüle ettiği "network hatası"
(Test 5B-1'in kapsadığı) gerçek cihazda da AYNI şekilde mi davranıyor?

**Adımlar:** Fiziksel iPhone'da Wi-Fi'ı kapatıp (veya Mac'in backend'ini
durdurup) bir plan isteği gönder.

**4 soru:** Kullanıcıya ne gösteriliyor (net bir hata mı, "Anlayamadım"
mı)? State ne oluyor? Repository'ye bir şey yazılıyor mu (yazılmamalı)?
Yanlışlıkla installed oluyor mu (olmamalı)?

---

### Test 5B-4 SONUÇ (beklemede)

---

### Test 5B-5 — Kullanıcı Shortcuts'ta gerçekten geri çıkarsa (P1)

**Sorulan soru:** "Kestirmelere Aktar"a basılıp Shortcuts açıldıktan
sonra kullanıcı HİÇBİR ŞEY yapmadan (import'u iptal edip) uygulamaya
geri dönerse ve dürüstçe "Ekleyemedim" derse, `reportInstallFailed()`
zinciri gerçek cihazda da (Swift testinin simüle ettiği gibi) doğru
çalışıyor mu?

**Adımlar:** Test 2'nin adımlarını tekrarla, ama Shortcuts'ta importu
iptal et, uygulamaya dön, "Ekleyemedim" butonuna bas.

**4 soru:** Kullanıcıya ne gösteriliyor (`setupFailedReason`)? State
`.setupFailed`'a mı geçiyor? Repository'de kayıt `.failed`'a mı
güncelleniyor (Phase 5A İş 0.5'in önerdiği `ios.notification.show`
capability'siyle test edilebilir)? Yanlışlıkla installed oluyor mu
(olmamalı)?

---

### Test 5B-5 SONUÇ (beklemede)

---

## Sonuç matrisi

| Test | Öncelik | Sonuç |
|---|---|---|
| 5B-1 — mevcut failure-path regresyonu | P0 | beklemede |
| 5B-2 — istemci timeout gap'i | P0 | beklemede |
| 5B-3 — conversation leakage kapsamı | P1 | beklemede |
| 5B-4 — gerçek network kaybı (cihaz) | P1 | beklemede |
| 5B-5 — Shortcuts'tan gerçek geri çıkış (cihaz) | P1 | beklemede |

---

## Bu testlerden sonra

- Test 5B-2 kullanıcıyı süresiz beklettiğini kanıtlarsa: bu, Phase 5B
  kapsamında bir DÜZELTME (explicit timeout) tetikleyebilir — kullanıcı
  onayı alınarak, ayrı bir commit'te.
- Test 5B-3, conversation leakage'ın gerçekten `installed`'a kadar
  sızabildiğini kanıtlarsa: bu bulgu **P0**'a yükseltilir ve
  `BuilderMachine`'e bir `resetConversation()` çağrısı eklenmesi ayrı
  bir düzeltme görevi olarak açılır.
- Tüm sonuçlar bu dokümana ve gerekirse `docs/ux.md`/`docs/capabilities.md`'ye
  işlenir.
- Phase 5B kapandığında sıradaki adım Phase 5C (gerçek NVIDIA soak
  testi) — ayrı bir SPEC/PLAN olarak hazırlanacak.
