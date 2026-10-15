# P2-B2B-LP1 — Offline corpus ve semantic oracle

Başlangıç HEAD: `5118ac272bb85044d7a719dc3887c080a08a2f8e`.
Yetki: yalnız yerel/offline LP1 kodu, sentetik veri, mock test ve dokümantasyon.
Gerçek model kalitesi ölçülmedi. API/anahtar/env/billing, production değişikliği,
Git stage/commit/push ve deploy yapılmadı. LP2 bütçe altyapısı uygulanmadı.

## Yedi yeni dosya

| Dosya | Sorumluluk |
| --- | --- |
| `src/evaluation/lp1-types.ts` | Corpus, tam oracle, sentetik çıktı ve skor sözleşmeleri |
| `src/evaluation/lp1-corpus.ts` | 91 eski metin adaptasyonu, 40 bağımsız yazılmış holdout, 13 ayrı fault seçimi |
| `src/evaluation/lp1-manifest.ts` | Canonical encoding, 131 sabit case hash ve corpus golden hash, overlap guard |
| `src/evaluation/lp1-evaluator.ts` | Yalnız bellek içi sentetik JSON değerlendirme; yapısal branch/izin/validation |
| `tests/lp1-corpus.test.ts` | 142 corpus/bütünlük/doğrulama testi |
| `tests/lp1-evaluator.test.ts` | 20 pozitif/adversarial scorer testi |
| `docs/p2-b2b-lp1.md` | Bu rapor ve LP2 STOP sözleşmesi |

P2-B2A'nın dosyaları, 104 senaryosu, CLI'si ve mevcut metrikleri değiştirilmedi.
Production adapter/API/auth/router/Local-First, paket manifesti ve bağımlılıklar
değişmedi. Yeni modüller production başlangıcından import edilmez; router OFF kalır.

## Corpus ve bağımsızlık

| Split/katman | Sayı | Açıklama |
| --- | ---: | --- |
| Regression dil metni | 91 | Mevcut girdiler aynen; mock yanıtı değil, yeni açık oracle kullanılır |
| Holdout dil metni | 40 | Model çıktısı görmeden yazılan sekiz kategori × beş |
| Dil corpus toplamı | 131 | Henüz hiçbir gerçek modele gönderilmedi |
| Fault-injection | 13 | Eski bozuk provider yanıtları, ayrı offline regresyon; dil paydasına girmez |

Holdout kategorileri: basit, parametreli, eksik bilgi, desteklenmeyen, çok adımlı,
güvenlik, belirsiz, olumsuzlama/düzeltme. Bozuk çıktı bir dil kategorisi değildir.

91 eski metin 91 farklı bağımsız dilsel yapı değildir: sayılar maskelendiğinde
43 metin kalır; bunlar bile 43 bağımsız anlam kanıtı sayılmaz. `familyId` sayısal
varyasyonları kümeler. 40 holdout yeni ifade yapılarıyla yazıldı; aynı dosyada
açık oldukları için gizli/erişilemez veya adversarial-contamination-proof değildir.
Gerçek model karşılaştırmasından önce oracle'lar insan/bağımsız incelemesine
tabi tutulmalı. Prompt tuning sonrası bu holdout artık yeni holdout sayılmamalı.

Duplicate denetimi NFC, Türkçe lower-case, noktalama/sembol ve boşluk
normalizasyonu kullanır. Sayı-maskeli eşleşme ve `familyId` karşılaştırması
splitler arası lexical overlap yakalar. Son durumda exact duplicate ve bu
kurallara göre beklenmeyen cross-split overlap sıfırdır. Bu kontrol semantik
sızıntının otomatik kanıtı değildir; kavramsal benzerlik manuel inceleme gerektirir.
Örneğin pil ve bildirim kavramları doğal olarak her iki splitte de bulunur.

## Oracle sözleşmesi ve normalleştirilmiş çıktılar

Her vaka açık intent, status, semantic trigger/parametre, eylem semantikleri,
clarification field/reason veya null, onay politikası, runtime izinleri,
dış kurulum gereksinimleri, yapısal DSL beklentisi veya null ve risk içerir.
Tam oracle alanlarının bulunması, yorumların gerçek modelde doğrulandığı anlamına gelmez.

Önceki 26 validator-only vakadan 13 çok adımlı örnekte evet→kilit ve
hayır→bildirim dalları açıkça belirtildi. 13 onaysız riskli örnek LP1 güvenlik
politikası gereği çalıştırılabilir plan olmadan ret bekler. Bu bir üretim API
status değişikliği değildir: `safety_rejected`, LP1 normalleştirilmiş fixture
sözleşmesidir. Unsupported için gerekçe kodları benchmark taxonomy'sidir;
mevcut API'nin birebir alanları değildir.

Mevcut registry'de bildirimin `notifications` gereksinimi dış Kestirmeler kurulum
gereksinimidir; bu uygulamanın verilmiş OS izni olduğu iddia edilmez. Tesla
örnekleri `tesla_account` gereksinimini ayrıca taşır. Runtime permission listesi
bugünkü bu capability'lerde boştur; gelecekte registry değişirse oracle'lar
yeniden incelenmeli, mevcut evaluator ayrıca gerçek permission validator'ını çalıştırır.

`evaluateLP1(case, fixture)` yalnız `{mode: mock/simulated, caseId, modelLabel,
outputJson}` alır. Provider/client callback, transport, SDK nesnesi, credential
veya env yolu yoktur. Gerçek SDK JSON'unu bu normalleştirilmiş kayda çeviren
bridge bu fazda yoktur. Model etiketi yalnız sentetik test etiketi; bir modeli
çalıştırmaz. Çıktıdaki intent/semantic/plan/izin beyanları oracle ve gerçek
validator zinciriyle karşılaştırılır; modelin kendi "güvenli" iddiasına güvenilmez.

## Yeni scorer'ın B2A'dan farkı

- JSON/envelope veya DSL schema hatasında bütün doğruluk skorları false kalır.
- `invalid_parameter_value` ve `missing_required_parameter` dahil **her validation
  hatası** capability başarısını engeller. Eski yanlış kod adları kullanılmaz.
- Clarification kredisi status doğruysa ve soru field/reason eşleşiyorsa verilir;
  soru beklenirken plan üretilemez. Yanlış status doğru soru taşısa da başarısızdır.
- Pozitif soru doğruluğu ve gereksiz soru üretmeme doğruluğu ayrı raporlanır.
- Branch karşılaştırması `then`, `else`, koşul ve sırayı korur. Dallar flatten
  edilerek eşit kabul edilmez. Nonempty onay sorusu schema ile kontrol edilir;
  onay cümlesinin üslubu exact-string eşleştirilmez.
- Güvenlik reddi beklenirken herhangi bir çalıştırılabilir plan bulunması veya
  validation'da onaysız riskli eylem görülmesi safety violation sayılır. Bu,
  kasıtlı olarak muhafazakâr bir benchmark ölçümüdür; çalışma/kurulum yapılmaz.
- Model, kategori, split, family grupları ve model içindeki kategori/split/family
  grupları ayrı gösterilir. Paydası sıfır olan oran `null` (N/A), asla %100 değil.
- Raporlar `mode: mock/simulated`, `realModelQualityMeasured: false` taşır.
  Skorlar verilen fixture alt kümesine aittir; 131 corpus hash testi, 131 gerçek
  model çıktısının doğru olduğu iddiası değildir. Model/fixture tekrarları reddedilir.

## Hash sabitleme

Encoding: `lp1-canonical-json-v1`; nesne anahtarları code-point sıralı, diziler
sıralarını korur, sonlu JSON değerleri kabul edilir. Hash metnine NFC uygulanmaz.
Case hash: encoding + ID/input/category/split/familyId/oracle/risk dahil tüm vaka.
Corpus hash: ID sırasındaki case ID/hash çiftleri ve encoding.

131 case golden değeri ve bütün corpus golden değeri manifestte sabit literal'dir;
testler bunları yeniden üretip kendileriyle kıyaslamaz. İlk yazar dondurması
model gözlemi olmadan yapıldı; fixture veya oracle değişince test başarısız olur.
Bu yanlışlıkla değişiklik yakalama mekanizmasıdır, hem corpus hem golden'ı
değiştirebilen kötü niyetli repo editörüne karşı değişmezlik garantisi değildir.

## Doğrulama

```sh
npm run build
npx vitest run tests/lp1-corpus.test.ts tests/lp1-evaluator.test.ts
npm test
```

- Yeni testler: 162 (142 corpus + 20 evaluator).
- TypeScript build: PASS.
- Pozitif fixture'lar elle yazıldı; corpus oracle'ını kopyalayıp başarı üreten
  fixture fabrikası yok. 131 hash/oracle testi veri sözleşmesini kontrol eder.
- Ek olarak tüm çalıştırılabilir oracle planları değişmemiş validation zincirine girer.
- İlk hedef koşudaki sentetik Sentry parametresi `state`→`mode` düzeltildi.
- Sandbox tam koşusu localhost listen EPERM nedeniyle başarısız/takılı kaldı ve
  durduruldu. Son kaynaklarla izinli tam koşu **868/868 PASS, 41 test dosyası**:
  önceki 706 test + 162 LP1 testi. Önceden var olan untracked auth-server
  dosyasındaki 5 test de bu toplamda bulunur; dosya değiştirilmedi.
- Gerçek Groq veya başka AI API çağrısı, key/env/billing erişimi sıfırdır.
- Kodun LP1'e eklediği testler tümüyle offline'dır; mevcut regresyondaki localhost
  HTTP testleri SDK-to-mock davranışını sınar, gerçek sağlayıcıya bağlanmaz.
- Bağımsız doküman okuyucu, 131 corpus ile gerçek model sonucu ayrımını, hash
  sınırlarını, production izolasyonunu ve LP2'nin uygulanmadığını doğru anladı.
  Tam regresyon sonucu konusundaki belirsizlik bu nihai sonuçla giderildi.
- İlgisiz 15 dosya içerik SHA-256 karşılaştırmasıyla korundu; staging boş,
  HEAD başlangıç commit'inde kaldı. 7 yeni dosyada whitespace kontrolü PASS.

## Gelecek LP2 STOP sözleşmesi — uygulanmadı

| Durum | Gereken davranış |
| --- | --- |
| Usage eksik/belirsiz | STOP; rezervasyonu serbest bırakma |
| Crash sonrası restart | STOP; belirsiz çağrıyı otomatik yeniden gönderme |
| Repair timeout | STOP; iki çağrıyı da bütçeye dahil et |
| Token/USD/çağrı limiti aşılacak | Dispatch öncesi STOP |
| Abort sonrası kullanım belirsiz | STOP; rezervasyonu koru |
| 429/5xx/ağ hatası | Otomatik retry yok |

LP1 sonunda durulur. LP2, gerçek test bridge'i, API pilotu/key/billing, P3/P4,
Git işlemleri ve deployment ayrı yetki gerektirir. RH-02/RH-07 açık kalır.
