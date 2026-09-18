# Phase 3B — Real iPhone Validation Plan

Bu doküman kod içermez. Amacı: gerçek bir iPhone + Xcode ortamında,
Phase 3A'nın bıraktığı **candidate mechanism**'ları (docs/ios-bridge.md
§5) sırayla doğrulayıp MVP mimarisini kilitlemek.

**Temel kural:** bir test geçmeden bir sonraki teste dayanan hiçbir
varsayım yapılmaz. Bir testin "hayır" sonucu ürünü durdurmaz — ürünün
UX'i o sonuca göre şekillenir (bkz. §"Sonuç matrisi").

---

## Ön koşullar

- Fiziksel iPhone (simülatörde Bluetooth/CarPlay/Tesla test edilemez)
- Xcode + bu konuşmada yazılan `ios-bridge/` Swift paketi
- Tesla hesabı ve (mümkünse) gerçek bir Tesla araç bağlantısı — yoksa
  Test 5/9 CarPlay/Bluetooth simülasyonuyla (örn. eşleştirilmiş bir
  Bluetooth cihazı) yapılabilir, Tesla'ya özgü kısım ayrı not edilir
- Kayıt: her testin sonucu ekran görüntüsü + kısa video ile belgelenmeli
  (Shortcuts'ın gösterdiği gerçek diyalog metinleri, ürün kopyalarımızın
  doğruluğunu etkiliyor)

---

## Testler

### Test 1 — Shortcut import (P0)

**Sorulan soru:** `shortcuts://import-shortcut?url=...` gerçekten bir
`.shortcut` dosyasını Shortcuts uygulamasına aktarıyor mu?

**Adımlar:**
1. Basit bir `.shortcut` dosyası oluştur (tek eylem: bildirim göster)
2. Bu dosyayı bir URL'de barındır (veya yerel dosya URL'i dene)
3. `UIApplication.shared.open(URL(string: "shortcuts://import-shortcut?url=...&name=..."))`
4. Shortcuts uygulaması açılıyor mu, bir önizleme/onay ekranı gösteriyor mu?

**Geçti:** Shortcuts açılır, kullanıcıya "Kısayolu Ekle" tarzı bir onay
ekranı gösterir, kullanıcı onaylayınca shortcut Shortcuts kütüphanesinde
görünür.
**Kaldı:** URL şeması tanınmıyor / hata veriyor / hiçbir şey olmuyor.

**Sonuç etkisi:** Hayır çıkarsa, `user_assisted_import` kurulum yöntemi
tamamen elden geçirilmeli — alternatif: kullanıcıya manuel "Shortcuts'ı
aç, şu eylemi ekle" rehberi (yani her şey `guided_manual`'a döner).

---

### Test 2 — Personal Automation'a programatik bağlama (P0)

**Sorulan soru:** Test 1 başarılıysa, içe aktarılan shortcut bir
Personal Automation tetikleyicisine (Bluetooth/CarPlay) **programatik
olarak** bağlanabiliyor mu, yoksa kullanıcı bunu Shortcuts'ın Otomasyon
sekmesinde **elle** mi yapmak zorunda?

**Adımlar:**
1. Test 1'deki shortcut'ı içe aktar
2. `import-shortcut` URL'ine bir tetikleyici parametresi eklemeyi dene
   (böyle bir parametre var mı, dokümantasyonda/deneme yanılmayla ara)
3. Alternatif: shortcut içe aktarıldıktan sonra Shortcuts'ın Otomasyon
   sekmesine git, o shortcut'ı seçip bir Bluetooth tetikleyicisi ekle —
   bu KAÇ dokunuş alıyor, hangi ekranlardan geçiyor, adım adım kaydet

**Geçti (iyimser):** Tetikleyici de programatik olarak bağlanabiliyor.
**Geçti (gerçekçi, muhtemel sonuç):** Tetikleyici bağlama YALNIZCA
kullanıcının Otomasyon sekmesinde elle yapması gereken ayrı bir adım.
**Kaldı:** Test 1 zaten başarısızsa bu test anlamsız, atla.

**Sonuç etkisi:** Bu testin sonucu, §"Sonuç matrisi"ndeki hangi UX
dalının kullanılacağını belirler. "Gerçekçi" sonuç çıkarsa (en olası),
`docs/ux.md` §3.6.b üç adımlı akışa güncellenir: **Kestirmeyi Hazırla →
Kestirmelere Ekle → Otomasyon Tetikleyicisini Bağla**, ve üçüncü adımın
ekranları (adım adım, Test 2'de kaydedilen gerçek Shortcuts akışına göre)
tasarlanır.

---

### Test 3 — Bluetooth disconnect tetikleyicisi (P0)

**Sorulan soru:** Bir Bluetooth cihazının bağlantısı kesildiğinde
otomasyon gerçekten çalışıyor mu? iOS 26'da onaysız çalışabildiği iddiası
(docs/capabilities.md §1.1) doğru mu?

**Adımlar:**
1. Shortcuts'ta manuel olarak "Bluetooth bağlantısı kesildiğinde →
   bildirim göster" otomasyonu kur (bu adımın kendisi elle yapılıyor,
   test edilen şey programatik kurulum DEĞİL, tetikleyicinin çalışması)
2. "Ask Before Running"i kapat (iOS sürümü izin veriyorsa)
3. Eşleştirilmiş Bluetooth cihazının bağlantısını kes (kulaklık, araç
   vb.)
4. Bildirim geldi mi, geldiyse onay istendi mi?

**Geçti:** Bildirim geldi, iOS sürümüne göre beklenen onay davranışı
(docs/capabilities.md tablosuyla) eşleşti.
**Kaldı:** Tetikleyici hiç ateşlenmedi / beklenenden farklı davrandı.

**Not:** Bu test, cihazın gerçek iOS sürümünü `docs/capabilities.md`
§1.1'deki tabloya ekler — iOS 16/17/18 boşluğu bu testle kısmen
kapanabilir.

---

### Test 4 — CarPlay disconnect tetikleyicisi (P0)

Test 3 ile aynı prosedür, CarPlay bağlantısı için. CarPlay erişimi yoksa
bu test ertelenir ve ürün kararı geçici olarak yalnızca Bluetooth
fallback'ine dayanır (docs/capabilities.md §3'teki öncelik sırası
etkilenmez, sadece CarPlay doğrulaması gecikir).

**Geçti/Kaldı kriteri:** Test 3 ile aynı.

---

### Test 5 — Tesla Sentry Mode eylemi (P0)

**Sorulan soru:** Tesla'nın resmi Shortcuts eylemi gerçekten Sentry
Mode'u açıyor mu, ve `Ask Before Running` kapalıyken sessizce çalışıyor
mu?

**Adımlar:**
1. Tesla uygulamasının Shortcuts entegrasyonunu etkinleştir
2. Shortcuts'ta Tesla Sentry Mode eylemini manuel ekle, çalıştır
3. Bir otomasyon içinde (Test 3'teki otomasyonun eylemini bununla
   değiştirerek) onaysız çalıştığını doğrula

**Geçti:** Sentry Mode gerçekten açılıyor, araçtan bildirim/teyit
alınabiliyor.
**Kaldı:** Eylem yok / hata veriyor / onay istiyor ve kapatılamıyor.

**Not:** docs/capabilities.md'de bu satır `evidence: "secondary"`
olarak işaretliydi — bu test geçerse `vendor_docs`'a yükseltilir.

---

### Test 6 — Kullanıcı onayı (Apple'ın kendi ekranı) (P1)

**Sorulan soru:** Test 1/2'nin ürettiği onay ekranının metni ne? Bizim
`docs/ux.md` §3.6.b'deki "iPhone güvenlik nedeniyle son kurulumu senin
onaylamanı istiyor" kopyamız, Apple'ın gerçekte gösterdiği ekranla
tutarlı mı?

**Adımlar:** Test 1/2 sırasında Apple'ın gösterdiği her ekranın tam
metnini/ekran görüntüsünü kaydet.

**Geçti/Kaldı:** Bu bir doğrulama değil, bir belgeleme testi — çıktısı
`docs/ux.md`'nin kopya metnini güncellemek için kullanılır.

---

### Test 7 — `installed` doğrulaması (P0)

**Sorulan soru:** Kullanıcı "Ekledim" dedikten sonra, uygulamanın
`installStatus: "installed"` yazması GERÇEĞİ yansıtıyor mu? Yanlış
pozitif (kullanıcı iptal ettiği halde "Ekledim" derse) veya yanlış
negatif var mı?

**Adımlar:**
1. Tam akışı çalıştır, "Ekledim" de, Shortcuts'ta otomasyonun gerçekten
   orada olduğunu doğrula
2. Ayrı bir denemede: akışı yarıda bırak (Shortcuts'ta iptal et),
   uygulamaya dön, ne olduğunu gözlemle — uygulama bunu nasıl anlıyor?

**Geçti:** `installed` durumu yalnızca gerçekten kurulmuşken oluşuyor;
iptal durumunda kullanıcı "Ekleyemedim" diyebiliyor ve `setup_failed`
doğru tetikleniyor.
**Kaldı:** Uygulama iptal durumunu ayırt edemiyor (bu, `waitingForUser`
state'inin NEDEN otomatik ilerlemediğinin tam kanıtı olur — kullanıcı
beyanına güvenmek zorunda olduğumuzu doğrular).

---

### Test 8 — Uygulamadan otomasyon yönetimi (P1)

**Sorulan soru:** Kurulmuş bir otomasyonu uygulama içinden
aç/kapat/sil işlemleri gerçek Shortcuts durumuyla senkronize kalıyor
mu, yoksa yalnızca kendi veritabanımızda mı yaşıyor?

**Adımlar:**
1. Uygulamadan bir otomasyonu "Kapalı" yap → Shortcuts'ta o otomasyon
   gerçekten devre dışı kaldı mı?
2. Shortcuts uygulamasından otomasyonu elle sil → bizim uygulamamız
   bunu fark ediyor mu, yoksa "var" gösterip kullanıcıyı yanıltıyor mu?

**Geçti:** Senkronizasyon var veya en azından tutarsızlık durumu
kullanıcıya dürüstçe gösteriliyor ("Bu otomasyon Shortcuts'ta
bulunamadı" gibi).
**Kaldı:** Sessiz tutarsızlık — uygulama "aktif" diyor ama gerçekte
silinmiş.

**Not:** Bu, muhtemelen programatik okuma API'si olmadığı için (Test
1/2'nin türevi bir kısıt) tam çözülemeyebilir; o zaman dürüst bir
"bilmiyoruz" durumu tasarlanmalı (MASTER_SPEC §18 ruhuyla tutarlı).

---

## Sonuç matrisi

Test 1 ve 2'nin kombinasyonu, MVP'nin UX'ini belirler:

| Test 1 | Test 2 | Sonuç |
|---|---|---|
| ✅ | ✅ | En iyi durum: gerçekten tek dokunuşa yakın akış. `docs/ux.md` §3.6.b olduğu gibi kalır. |
| ✅ | ❌ (gerçekçi sonuç) | Üç adımlı akış: **Kestirmeyi Hazırla → Kestirmelere Ekle → Otomasyon Tetikleyicisini Bağla**. Eylem otomatik aktarılır, tetikleyici bağlama adımı eklenir (yeni bir `linkingTrigger` state'i, Test 2'de kaydedilen gerçek adımlara göre tasarlanır). |
| ❌ | — | Her şey `guided_manual`: kullanıcı Shortcuts'ı açıp her adımı elle kurar. `docs/capabilities.md`'deki tüm `user_assisted_import` satırları `guided_manual`'a düşürülür — bu, registry'de tek satırlık bir değişiklik, kod mimarisi zaten buna hazır. |

Hangi satır gerçekleşirse gerçekleşsin, **State machine'in kendisi
değişmez** — yalnızca `SetupKind` enum'ına olası bir üçüncü dal
(`linkingTrigger`) eklenir ve registry'deki `installMethod` değerleri
güncellenir. Bu, Phase 1.5'te kurduğumuz "registry değişir, UI/state
machine mimarisi değişmez" ilkesinin gerçek dünyada sınanmasıdır.

## Bu testlerden sonra

Sonuçlar `docs/capabilities.md` (evidence seviyeleri güncellenir),
`docs/ux.md` §3.6 (gerekirse üç adımlı akışa genişletilir) ve
`docs/ios-bridge.md` §5 (candidate → confirmed/rejected) dosyalarına
işlenir. Ancak bundan sonra Swift kodu (varsa yeni state, `HTTPBackedPlanner`,
gerçek `import AppIntents`) yazılır — spekülatif olarak değil, bu
testlerin gerçek çıktısına göre.
