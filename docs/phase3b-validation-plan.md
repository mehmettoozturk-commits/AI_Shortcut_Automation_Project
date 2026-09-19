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

### Test 1 SONUÇ (2026-09-18, gerçek iPhone 16 Pro, iOS 26, kablosuz)

**KALDI — ama son derece bilgilendirici bir "kaldı".**

**Yöntem:** Elle yazılmış (Apple/iCloud tarafından imzalanmamış), tek
eylemli ("Show Notification") bir `.shortcut` XML plist dosyası
hazırlandı, Mac'te yerel ağa (`http://192.168.1.x:8765/...`) açıldı, iki
farklı yoldan denendi:

1. `shortcuts://import-shortcut?url=<http-link>&name=...` — telefonda
   `xcrun devicectl device process launch --payload-url ...` ile
   Shortcuts uygulamasına doğrudan iletildi.
2. Dosya Safari ile indirilip Dosyalar uygulamasından "Shortcuts ile
   Aç" ile elle açıldı (URL şemasından bağımsız, dosya-tabanlı ikinci
   bir yol).

**Gözlem:**
- Yol 1: Shortcuts açıldı, **"Import Failed"** hatası verdi. Sunucu
  logunda telefondan gelen hiçbir HTTP isteği YOK — yani Shortcuts,
  dosyayı ağdan çekmeden reddetti (muhtemelen ATS: Apple'ın kendi
  uygulamaları düz `http://` bağlantısını denemeden reddediyor —
  bu ayrıca doğrulandı: aynı URL Safari'de normal şekilde açılıp
  indirildi, yani ağ/erişilebilirlik sorunu değildi).
- Yol 2 (kesin sonuç): Dosyadan elle açmada Shortcuts şu **tam
  metni** gösterdi: **"Shortcut cannot be opened — Importing unsigned
  shortcut files is not supported."**

**Bu, transport'tan (http/https, URL şeması/dosya) bağımsız, iOS'un
platform seviyesinde bir kuralı:** Apple/iCloud tarafından imzalanmamış
`.shortcut` dosyaları, kaynak ne olursa olsun içe aktarılamıyor. Bizim
(ya da AI'ın çalışma zamanında) sıfırdan ürettiği bir shortcut dosyası
kullanıcıya bu yoldan asla verilemez.

**Açık kalan, test edilmemiş soru:** Bu sonuç, `shortcuts://import-shortcut`
mekanizmasının kendisini geçersiz kılmıyor — mekanizma URL'i tanıdı ve
işledi, yalnızca **imzasız içerik** reddedildi. Apple'ın kendi
imzaladığı bir shortcut (örn. Shortcuts uygulamasında elle oluşturup
"iCloud Bağlantısını Kopyala" ile paylaşılan, önceden hazırlanmış bir
şablon) aynı `shortcuts://import-shortcut?url=<icloud-link>` yoluyla
denenmedi — bu, `user_assisted_import`'ın herhangi bir biçimde hayatta
kalıp kalamayacağını belirleyecek doğal bir sonraki adım (bkz. altta
"Sonuç etkisi — güncellendi").

**Sonuç etkisi — güncellendi:** `docs/capabilities.md` §1.2, kanıt
seviyesi `secondary`'den gerçek cihaz testine yükseltildi (bkz. o
dosya). Registry'deki `installMethod` değerleri **henüz değiştirilmedi**
— Apple-imzalı şablon yolu (yukarıdaki açık soru) test edilmeden
`guided_manual`'a topluca geçmek erken olur; o test "hayır" çıkarsa bu
geçiş tek satırlık bir registry değişikliği olarak yapılabilir (mimari
zaten buna hazır, bkz. §"Sonuç matrisi").

---

### Test 1b SONUÇ (2026-09-18, aynı cihaz, aynı oturum) — açık soruyu kapattı

**GEÇTİ.**

**Yöntem:** Telefonda Shortcuts uygulamasında elle, tek eylemli ("Show
Notification", metin "Phase 3B Test 1 PASS") bir kestirme oluşturuldu,
paylaş menüsünden **iCloud Bağlantısını Kopyala** ile
`https://www.icloud.com/shortcuts/<id>` linki alındı.

**İlk deneme (yanlış yöntem, YANLIŞ POZİTİF-olmayan ama yanıltıcı bir
hata üretti):** iCloud linki, Test 1'deki gibi
`shortcuts://import-shortcut?url=<icloud-link>&name=...` içine
sarılıp `devicectl --payload-url` ile Shortcuts'a doğrudan verildi.
Sonuç: **"The file isn't in the correct format."** Bu, imza reddi
DEĞİL — `icloud.com/shortcuts/<id>` bir HTML önizleme sayfasıdır, ham
`.shortcut` kaynağı değil; `import-shortcut`'ın `url` parametresi
doğrudan bir dosya kaynağı bekliyor, iCloud'un kendi paylaşım
sayfasını değil. Bu adım metodolojik bir hataydı, sinyal değil.

**Düzeltilmiş yöntem:** Aynı iCloud linki, `shortcuts://import-shortcut`
sarmalayıcısı OLMADAN, doğrudan Safari'ye (`com.apple.mobilesafari`)
payload URL olarak verildi — yani gerçek kullanıcı davranışının
birebir aynısı (bir linke tıklamak). iOS'un Universal Links mekanizması
bunu otomatik olarak Shortcuts uygulamasına yönlendirdi.

**Gözlem (kullanıcının tam onayı):**
1. Shortcuts açıldı, içe aktarma ekranı geldi.
2. "Ekle" (Add Shortcut) başarıyla çalıştı.
3. Kestirme "Kestirmelerim"de göründü.
4. Çalıştırıldığında bildirim doğru metni gösterdi: **"Phase 3B Test 1
   PASS"**.

**Sonuç:** `user_assisted_import` **tamamen çöpe gitmiyor** — ama
kapsamı Test 1'in kanıtladığı kısıtla daralıyor:

> AI, çalışma zamanında özgün/rastgele bir `.shortcut` dosyası
> **üretip doğrudan veremez** (imzasız içerik kesin red). Ama
> **önceden Shortcuts uygulamasında elle hazırlanmış ve Apple/iCloud
> tarafından imzalanmış bir şablon**, `shortcuts://import-shortcut`
> yerine düz bir iCloud paylaşım linkiyle (Universal Link) kullanıcıya
> verildiğinde içe aktarılabiliyor, kütüphaneye ekleniyor ve
> çalıştırılabiliyor.

**Sonuç etkisi:** Kurulum yöntemi ikiye ayrılmalı — `automatic`
(hâlâ kanıtlanmadı, hâlâ yasak) ile `guided_manual` arasında üçüncü,
daha spesifik bir orta yol var: **önceden yazılmış, imzalanmış şablon
kütüphanesinden seçip iCloud linkiyle içe aktarma.** Bu,
`docs/capabilities.md` §1.2 ve registry'nin `InstallMethod` enum'ı
(şu an `automatic | user_assisted_import | guided_manual |
app_intent_exposure`) için isimlendirme/kapsam kararını gerektiriyor —
kod tarafına dokunmadan önce ürün kararı olarak konuşulmalı (bkz. o
dosyadaki not).

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

### Test 2 SONUÇ (2026-09-18, aynı cihaz — Test 1b'nin şablonuyla)

**GEÇTİ (gerçekçi sonuç — planın öngördüğü, en olası sonuç).**

**Yöntem:** Test 1b'de eklenen "AI Test Kestirmesi" kullanılarak,
Shortcuts'ın Otomasyon sekmesinde elle bir otomasyon kuruldu (Bluetooth
tetikleyici + var olan şablonu eylem olarak seçme).

**Gözlem (kullanıcının raporu):**
1. **Tetikleyici bağlama elle yapıldı** — programatik/otomatik bir
   bağlanma olmadı, import sırasında da sorulmadı. Kullanıcı bilinçli
   olarak Otomasyon sekmesine gidip kurdu.
2. **Düşük sürtünme:** var olan "AI Test Kestirmesi" şablonu, eylem
   seçim ekranında **tek dokunuşla** seçildi — yeniden inşa etmeye
   gerek kalmadı (adım adım eylem eklemek yerine, hazır kestirmeyi
   doğrudan bir eylem olarak referans alabiliyorsunuz).
3. Bluetooth bağlantısı gerçekten kesildiğinde bildirim **otomatik
   geldi** — "Ask Before Running" onayı çıkmadı (bu aynı zamanda
   Test 3'ü de doğruluyor, bkz. altta).

**Sonuç:** Tam olarak planın öngördüğü "gerçekçi" dal doğrulandı:
tetikleyici bağlama, `user_assisted_import`'ın **ayrı, elle yapılan
bir adımı** — ama önceden hazırlanmış bir şablonu tekrar inşa etmeden,
tek dokunuşla mevcut otomasyona eylem olarak eklemek mümkün. Bu, üç
adımlı akışı (Kestirmeyi Hazırla → Kestirmelere Ekle → Otomasyon
Tetikleyicisini Bağla) makul bir UX yapıyor — üçüncü adım "15 ekranlık
bir kurulum" değil, "bir kez Otomasyon sekmesine git, tetikleyiciyi
seç, hazır kestirmeyi tek dokunuşla eylem olarak seç" kadar kısa.

**Sonuç etkisi:** `docs/ux.md` §3.6.b'nin üç adımlı akışa genişletilmesi
gerekiyor (henüz yapılmadı — bir sonraki adım). Registry/`InstallMethod`
tarafında Test 1b'nin açtığı soruyla birleşik ele alınmalı.

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

### Test 3 SONUÇ (2026-09-18, Test 2'nin yan ürünü olarak doğrulandı)

**GEÇTİ.**

Test 2'yi kurarken (Bluetooth disconnect tetikleyicisi + "AI Test
Kestirmesi" eylemi) aynı zamanda Test 3'ün sorusu da fiilen test
edilmiş oldu: kullanıcı eşleştirilmiş cihazın Bluetooth bağlantısını
gerçekten kesti, bildirim **onay istemeden, otomatik geldi.**

Bu, `docs/capabilities.md` §1.1'deki iOS 26 satırını ("Bluetooth:
onaysız çalışabilir") **`apple_docs`'tan gerçek cihaz kanıtına**
yükseltiyor — cihaz: iPhone 16 Pro, iOS 26. iOS 16/17/18 boşluğu hâlâ
kapanmadı (yalnızca bu tek cihaz/sürüm test edildi).

---

### Test 4 — CarPlay disconnect tetikleyicisi (P0)

Test 3 ile aynı prosedür, CarPlay bağlantısı için. CarPlay erişimi yoksa
bu test ertelenir ve ürün kararı geçici olarak yalnızca Bluetooth
fallback'ine dayanır (docs/capabilities.md §3'teki öncelik sırası
etkilenmez, sadece CarPlay doğrulaması gecikir).

**Geçti/Kaldı kriteri:** Test 3 ile aynı.

### Test 4 SONUÇ (2026-09-18) — ERTELENDİ (donanım yok)

**Hardware unavailable.** Kullanıcının Tesla'sı Apple CarPlay
desteklemiyor (Tesla kendi bilgi-eğlence sistemini kullanıyor, CarPlay
entegrasyonu yok) ve ayrı bir CarPlay'i olan araç/cihaz erişimi de yok.
Plan §"Test 4"ün öngördüğü gibi: bu test ertelendi, ürün kararı geçici
olarak yalnızca Bluetooth fallback'ine dayanıyor
(`docs/capabilities.md` §3'teki CarPlay → Bluetooth → Konum öncelik
sırası etkilenmiyor, sadece CarPlay satırının gerçek cihaz kanıtı
gecikiyor — hâlâ `apple_docs` seviyesinde kalıyor).

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

### Test 5 SONUÇ (2026-09-18/19, gerçek Tesla + iPhone 16 Pro) — GEÇTİ

**Yöntem ve gözlem, sırayla:**

1. Tesla uygulaması telefonda kurulu (`com.teslamotors.TeslaApp`,
   v4.60.5, `devicectl` ile doğrulandı) ve hesaba giriş yapılmış.
2. Shortcuts'ta eylem aramasında "tesla" yazınca resmi eylem çıktı:
   **"Nöbetçi Modu"** (Sentry Mode'un Türkçe yerelleştirmesi).
3. İlk çalıştırmada eylem bir **Enable/Disable** parametresi sordu —
   bunun nedeni parametrenin sabitlenmemiş olmasıydı (OS düzeyinde bir
   onay değil, eylemin kendi yapılandırma sorusu). Parametre "Enable"
   olarak **sabitlendiğinde** bu soru bir daha çıkmadı.
4. Tek başına (Shortcuts editöründen) çalıştırıldığında Tesla
   uygulamasından bakılıp **Sentry Mode'un araçta gerçekten açıldığı**
   doğrulandı.
5. **Kritik adım — otomasyon içinde:** Test 3'teki Bluetooth-disconnect
   otomasyonunun eylemi, bildirim yerine bu sabit-parametreli "Nöbetçi
   Modu (Enable)" eylemiyle değiştirildi. Bluetooth cihazının bağlantısı
   gerçekten kesildiğinde, otomasyon **hiçbir onay istemeden** çalıştı
   ve Sentry Mode gerçekten devreye girdi.

**Sonuç:** Tam GEÇTİ — hem "eylem gerçekten çalışıyor mu" hem de "onaysız
çalışabiliyor mu" soruları, hem tek başına hem de gerçek bir otomasyon
tetikleyicisi içinde doğrulandı.

**Önemli, plandan bağımsız bir bulgu:** Sessiz çalışmanın koşulu,
eylemin parametresinin **sabit bir değere ayarlanmış olması** —
"Her Seferinde Sor" bırakılırsa (parametre boşsa) eylem otomasyon
içinde bile interaktif bir soru sorar. **Bu, AI'ın üreteceği/seçeceği
her Tesla eylemi için parametrelerin binding zamanında sabitlenmesi
gerektiği anlamına geliyor** — registry/compiler tarafında bir
kısıt/kontrol olarak not edilmeli (§"Sonuç etkisi").

**Sonuç etkisi:** `docs/capabilities.md`'de Tesla Sentry Mode satırının
kanıt seviyesi `secondary`'den gerçek cihaz kanıtına yükseltiliyor.
Ayrıca compiler contract'a (`src/compiler/contract.ts`) yeni bir kural
adayı çıktı: parametreli eylemler için `WFWorkflowActionParameters`
içindeki her parametrenin AI/compiler tarafından somut bir değerle
doldurulması zorunlu olmalı, "Ask Each Time"/boş parametre üretilmemeli
— bu, kod tarafında henüz uygulanmadı.

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

### Test 7 SONUÇ (2026-09-19, gerçek iPhone 16 Pro) — KALDI, ama beklenen şekilde

**Yöntem:** Planın orijinal adımları yerine (uygulamanın kendisi henüz
gerçek bir Shortcuts entegrasyonuna sahip olmadığı için — bkz. altta),
daha temel ve gerçekten test edilebilir bir soru arandı: **iOS,
`shortcuts://import-shortcut` sırasında başarı/iptal/hata durumunu
üçüncü taraf bir uygulamaya PROGRAMATİK olarak bildirebiliyor mu?**
`docs/ios-bridge.md` §3'te `x-callback-url`'in `run-shortcut` için
doğrulandığı biliniyordu; `import-shortcut` için hiç denenmemişti.

Yerel bir HTTP sunucusu (`/success`, `/cancel`, `/error` uç noktaları,
her isteği loglayan) kurulup şu URL tetiklendi:

```
shortcuts://x-callback-url/import-shortcut?url=<imzasız-dosya>&name=...
  &x-success=http://<mac-ip>:8766/success
  &x-cancel=http://<mac-ip>:8766/cancel
  &x-error=http://<mac-ip>:8766/error
```

**Gözlem:** Telefon yine "Importing unsigned shortcut files is not
supported" hatasını gösterdi (Test 1 ile tutarlı) — **ama sunucu
logunda `/success`, `/cancel`, `/error` uç noktalarından HİÇBİRİNE
istek gelmedi.** iOS, bu başarısızlığı hiçbir x-callback mekanizmasıyla
çağırana bildirmedi.

**Sonuç:** `import-shortcut` (en azından bu başarısızlık senaryosunda)
`x-callback-url`'i desteklemiyor veya tetiklemiyor. **Bu KALDI, ama tam
olarak planın "Kaldı" kriterinin öngördüğü şekilde:** uygulama, kullanıcı
tarafında ne olduğunu programatik olarak BİLEMİYOR. Bu, `waiting_for_user`/
`linking_trigger` state'lerinin kullanıcıya doğrudan sorması gereken
TASARIM KARARINI ("Ekledim mi?", "Bağladım mı?") gerçek cihaz kanıtıyla
doğruluyor — varsayım değil, kanıtlanmış bir kısıt.

**Önemli sınırlama (dürüstçe belirtilmeli):** Bu test yalnızca
BAŞARISIZLIK (imzasız red) yolunu kapsadı. Gerçek bir BAŞARILI import
sırasında (imzalı bir şablonla) `x-success`'in tetiklenip
tetiklenmediği hâlâ test edilmedi — bunun için ham, doğrudan
fetch'lenebilir imzalı bir `.shortcut` kaynağına ihtiyaç var (iCloud
paylaşım linkleri HTML sayfası döndürüyor, ham dosya değil — bkz. Test
1b'nin metodolojik notu). Bu, ayrı, henüz yapılmamış bir alt-test.

**Ayrıca not:** Planın orijinal Test 7 prosedürü ("uygulamadan tam akışı
çalıştır, Shortcuts'ta otomasyonun gerçekten orada olduğunu doğrula")
şu an test edilemez — çünkü uygulamanın kendisi hâlâ Phase 1 mock'ları
kullanıyor (`MockSetupService`, `InMemoryAutomationRepository`);
gerçek bir Shortcuts okuma/yazma entegrasyonu yok. Bu bir test
sonucu değil, mimari bir gerçek: gerçek entegrasyon yazılana kadar bu
kısım tekrar ziyaret edilmeli.

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

### Test 8 SONUÇ (2026-09-19) — ERTELENDİ (mimari kısıt, Test 7 ile aynı sebep)

**Test edilemez durumda — bu bir "kaldı" değil, önkoşulun eksikliği.**
Test 8'in sorduğu şey ("uygulamadan aç/kapat yap, gerçek Shortcuts
durumuyla senkron mu") gerçek bir okuma/yazma entegrasyonu gerektiriyor.
Şu an `AutomationRepository`/`SetupService` (TS ve Swift, ikisi de)
Phase 1 mock'ları — `InMemoryAutomationRepository` yalnızca bellek içi
bir liste tutuyor, gerçek Shortcuts API'sine hiç dokunmuyor. Yani
`toggleAutomation()` çağrıldığında gerçekte Shortcuts'ta HİÇBİR ŞEY
değişmiyor; senkronizasyon sorusu henüz anlamlı değil.

Test 7'nin x-callback-url bulgusuyla birleşince ortaya çıkan gerçek
resim: iOS, üçüncü taraf uygulamalara Shortcuts'ın iç durumunu
(kurulu mu, aktif mi, silinmiş mi) okuma/dinleme yolu sunmuyor gibi
görünüyor (resmi olarak aranmadı, ama Test 1/2/7'nin üçü de aynı
yönde işaret ediyor: Shortcuts tek yönlü bir kara kutu). **Ürün
sonucu:** `docs/capabilities.md`'ye eklenmesi gereken olası yeni bir
açık iş — "silindi/değişti" durumunu tespit edemiyorsak, MASTER_SPEC
§18 gereği uygulamanın "sanıyorum hâlâ aktif, ama emin değilim" gibi
dürüst bir belirsizlik durumu göstermesi gerekecek. Bu, gerçek native
adaptör (Phase 3C) yazılırken tasarlanmalı; şimdiden koda dökülmedi.

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
