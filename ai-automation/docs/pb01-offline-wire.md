# PB-01 — Offline strict wire ve kayıpsız decode

Başlangıç HEAD: `017994561f6dc4a0ad878d9492c1f6d52d3e8604`.
Bu çalışma yalnız offline sözleşmedir. Gerçek model/SDK kabulü, gerçek kalite,
çağrı/fatura üst sınırı, cihaz kurulumu ve production hazır oluşu kanıtlanmaz.

## Altı yeni dosya

| Dosya | Görev |
| --- | --- |
| `src/evaluation/pb01-json.ts` | Ham JSON grammar, duplicate/prototype/numeric/bounds koruması |
| `src/evaluation/pb01-wire.ts` | Ayrı versioned strict wire schema, lossless decode/encode |
| `src/evaluation/pb01-integration.ts` | Konservatif mevcut semantic→DSL→validation adaptörü ve ayrı coverage |
| `tests/pb01-json.test.ts` | 47 parser testi; bir test içinde 500 deterministik ağaç karşılaştırması |
| `tests/pb01-wire.test.ts` | 49 wire, adversarial, round-trip ve downstream testi |
| `docs/pb01-offline-wire.md` | Bu rapor |

Kapsam: üç kaynak + iki test + bir doküman.
Mevcut LP1/LP2/B2C/B2D-1, adapter/API/auth/router/Local-First/şema ve bağımlılık
dosyaları değişmez. Production başlangıcı yeni modülleri import etmez. Yeni
modüllerde SDK, provider factory, network, env/key/billing veya kurulum yolu yoktur.

## Ham JSON sınırı

Ham metin, nesne üzerinde JSON.parse çalıştırılmadan grammar olarak okunur.
Her object key için decode edilmiş string kimliğiyle tekrar denetlenir; `a`
ve `\u0061` aynı anahtar sayılır. JSON.parse yalnız bağımsız string token'larının
standart escape çözümlemesinde kullanılır. Nesneler null-prototype ile oluşturulur.
`__proto__`, `constructor`, `prototype` hem gerçek object key hem typed details
entry key düzeyinde reddedilir. Yalnız parse sonrası kontrolle duplicate yakalandığı
iddia edilmez. Prototype pollution girişimi veya duplicate son-değer kazanmaz.

Kodda sabit sınırlar (`PB01_LIMITS`):

| Sınır | Değer |
| --- | ---: |
| UTF-8 ham JSON | 65.536 byte |
| Bir çözülmüş string | 8.192 byte |
| Ham JSON derinliği (kök 0) | 32 |
| Ham JSON değer düğümü | 4.096 |
| Bütün details alanları toplam decode düğümü | 512 |
| Details semantic derinliği | 8 |

Details sayacı object container, array/scalar value ve nested object value
ziyaretlerini sayar; iç object hem value hem container olarak sayılır. Raw wire
wrapper derinliği ayrıca uygulanır. Sınırlar aşılınca kırpma veya kısmi başarı yoktur.
Unicode lone surrogate reddedilir. Number finite ve mutlak değer olarak
MAX_SAFE_INTEGER değerine eşit veya küçük olmalı (|n| ≤ 9007199254740991);
-0, overflow/underflow veya decimal→JS dönüşümünde
gizli yuvarlanma reddedilir. Değerin decimal canonical biçimi Number.toString
biçimiyle karşılaştırılır. Bu byte-for-byte JSON spelling garantisi değildir:
1.0 ile 1 aynı JSON sayısal değeri olarak kabul edilir; sayı string'e çevrilmez.

## Strict wire ve kayıpsızlık sınırı

`version=pb01-wire-v1`. Bütün object'ler closed ve alanları required. Dinamik
details nesnesi `{key,value}` dizisidir; value kapalı tagged union ile string,
number, boolean, null, array veya object taşır. İç object yine entry dizisidir.
Duplicate entry key de reddedilir. Null, boş string, boş object ve boş array
typed details içinde birbirinden farklı kalır; nested round-trip test edilir.
Object entry listesi sıralı işlem listesi değil, JSON object temsili olarak
tanımlıdır: object key sırası/JSON escape yazımı semantik veri değildir. İç JSON
array sırası korunur. Özellikle sayısal object key'lerinin JS enumeration sırası
başka olsa bile key/value eşleşmesi değişmez.

Wire confidence null, semantic optional confidence yokluğu olarak kodlanır;
wire details null, optional details yokluğudur. Boş entry dizisi ise açık boş
object'tir. Bu yokluk temsilleri encoder ile tersine çevrilebilir. Step message
null, semantic şemanın nullable message alanında null kalır; encoder, semantic
message tamamen yoksa bunu null'a çevirmek yerine temsil edilemez diye reddeder.
Trigger null da null kalır. Version metadata sonucu ayrıca korunur.

Semantic encoder arbitrary getter/callback nesnesi değil, bounded JSON metni alır.
Kaynak/decoded semantic değerler canonical karşılaştırılır; bilinmeyen alan
silinmez. Verinin temsil edilemediği yerde açık hata vardır. Kayıpsızlık,
wire↔semantic değer sınırına aittir; mevcut builder'ın tüm veriyi DSL'e kayıpsız
taşıdığı anlamına gelmez. Semantik katalog enum'ları mevcut registry'den türetilir;
gerçek pilot profilinde katalog/revision sabitleme ayrıca gerekir.

Entity isimleri ortak listedendir; duplicate entity ve bilinmeyen isim reddedilir.
Condition ve batteryLevel değerleri mevcut entity mapper'ın sessizce yutacağı
biçimlerdeyse reddedilir. Trigger/action semantic kind ayrımı yapılır. Provider'a
cihaz capability ID enum'ları verilmez; bilinmeyen/device ID semantic kabul edilmez.

## Downstream: açıkça dar destek kümesi

Mevcut converter eksik confidence için 0.75 üretebilir; bu bridge önce
`unsupported_by_offline_bridge: missing_explicit_confidence` döner. Açık confidence
0–1 aralığında olmalıdır. Mevcut builder riskli eylemler için onay/branch ve bazı
parametre default'ları üretebilir. Bridge bunları model başarısı saymaz; riskli
eylem, ask_confirmation ve temsil edilemeyen branch/onay davranışını açıkça reddeder.
Bu ret production builder'ın güvensiz olduğu iddiası değildir.

Action details yalnız gerçekten parametre karşılığı varsa kabul edilir. Kalan
key/value, null/empty farkı veya nonnull message builder'da kaybolacaksa ret olur.
Gerekli parametre açık verilmelidir; default'a düşülmez. Nonempty entities bu
dar DSL adaptöründe ayrıca unsupported'dır; lossless wire decoder bunları yine
koruyabilir. Trigger details açık verilmelidir. Kayıpsız decode başarıyken downstream
unsupported olması beklenen ve ölçülen bir durumdur, bu vakalar gizlenmez.

Kabul edilen düşük riskli örnekte sıra:
strict decode → mevcut semantic schema/kind/completeness → mevcut converter
(confidence açık) → temporal ambiguity guard → mevcut buildPlan → tam mevcut
schema/capability/permission/setup/safety validation zinciri.
Bu son adım `runValidationPipeline` üzerinden mevcut `validateSchema`,
`validateCapabilities`, `validatePermissions`, `validateSetupRequirements` ve
`validateSafety` fonksiyonlarını çağırır; yeni ikame validator yazılmaz.
Eksik bilgi/ambiguous time varsa doğrulanmış plan değil clarification sonucu vardır.
Üretilen trigger/action capability ve parametre değerleri kaynak semantic ile
yeniden karşılaştırılır; registry seçimi dışında capability uydurulamaz.
Draft'ın null device yokluğu, mevcut builder/API'nin DSL temsilindeki gibi
omit edilir; gerçek bir device değeri silinmez. Permission grant listesi boştur;
provider izin verdiğini iddia ederek değiştiremez. Gelecekteki runtime izin
gereksinimi test seam'i gerçek permission validator'da ret üretir.

## Kanıt ve kapanış

`npm run build` PASS. Yeni testler 96/96 PASS (47 parser + 49 wire/integration).
16 Ekim 2026, başlangıç HEAD üzerine bu altı yeni dosyanın son çalışma ağacıyla
tam backend `npm test`: **1106/1106 PASS, 47 dosya** (önceki 1010 + 96).
Toplam, önceden mevcut untracked auth-server dosyasındaki 5 testi içerir;
o dosya değiştirilmedi. Tam regresyondaki eski localhost mock testleri için yerel
port izni kullanıldı; dış sağlayıcı çağrısı yapılmadı.

İlk hedefli koşuda 3 test, Vitest'in array satırlarını argümanlara açması nedeniyle
yanlış fixture ile başarısız oldu; fixture tablo nesneleriyle düzeltildi. Kaynak
wire şeması gevşetilmedi. Son kaynaklarla tüm hedefli ve regresyon testleri geçti.
Low-risk DSL testi yalnız status değil tam tetikleyici, action, parametre ve
validation sonucunu karşılaştırır. Builder'ın değer/capability değiştirmesi,
eksik confidence, message/details kaybı, riskli onay ve future permission reddi
adversarial olarak kontrol edilir.

`evaluatePB01Schedule` her planlanan fixture için wireDecodeStatus ve downstreamStatus
üretir. Wire PASS, downstream PASS değildir. Decode ret, downstream unsupported,
clarification, ret ve başarı ayrı sayılır; her coverage bütün scheduled paydasını
kullanır, boş payda null'dır. Bunlar fixture coverage ölçümleridir, gerçek model
kalitesi veya SDK invocation sayısı değildir.

**Kapanabilen:** offline strict wire, ham JSON güvenliği, lossless semantic decode
ve düşük riskli mevcut validation zincirine kontrollü aktarım.
**Açık:** riskli branch/onay tam temsili ve diğer downstream kapsam boşlukları;
gerçek Groq/SDK/model kabulü; tokenizer/usage/fiyat; global ledger/rollback/recovery;
holdout bağımsız incelemesi; RH-02/RH-07, P3/P4 ve gerçek işlem/maliyet yetkisi.
PB-01'in tamamı veya gerçek pilot bu raporla kapatılmaz. Gerçek dispatch ve
installationVerified bu offline modüllerin döndürdüğü sonuçlarda false kalır.
Commit/push için ayrı teknik karar
beklenir; production ve deploy açılmaz.
