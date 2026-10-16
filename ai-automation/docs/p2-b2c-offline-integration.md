# P2-B2C — Offline integration readiness

Başlangıç: `cfa8125f1addde9d9f7804320c01a8eb25558ccd`. Yalnız offline/mock.
Gerçek model kalitesi, SDK uyumluluğu, fatura veya production hazırlığı ölçülmedi.

## Kapsam

Dört yeni dosya: `src/evaluation/b2c-types.ts`, `src/evaluation/b2c-bridge.ts`,
`tests/b2c-bridge.test.ts`, bu doküman. LP1/LP2 mevcut kaynak ve testleri,
production başlangıcı, auth/API/router/Local-First, provider adapter'ları ve
bağımlılıklar değişmez. Yeni offline modül LP1 evaluator ve LP2 runner'ı import
eder; production bu bridge'i import etmez. Gerçek SDK/transport/key/env yoktur.
Callback seam ağ sandbox'ı değildir; yalnız elle yazılmış test scriptleri kullanılır.

## Üç ayrı doğruluk alanı

| Alan | Anlamı |
| --- | --- |
| `preflightValid` | Bellekteki provisional LP1 score passed; usage settle garantisi değil |
| `accountingSettled` | İlgili çağrı/run için LP2 muhasebe durumu; plan kalitesi değil |
| `qualityPublished` | Run tamamlandı, muhasebe STOP değil ve provisional skorlar yayımlanabilir |

Geçerli fakat yanlış bir plan: accounting settled, quality yayımlanır ama FAIL.
Geçerli plan fakat usage aşımı veya settle fsync hatası: provisional PASS olabilir,
quality yayımlanmaz. İlk yanlış JSON + başarılı repair: first-pass FAIL ve final
PASS ayrı kohortlardır. Repair timeout/abort/STOP durumunda ilk provisional hata
tanısı bellekte kalır, tamamlanmamış run kalite oranlarına başarı olarak girmez.
Quality yayını için run accountingSettled=true, en az bir attempt, her attempt'te
provisional score ve safety STOP bulunmaması birlikte zorunludur.
Tek bir booleandan başarı türetilmez. Run düzeyinde accountingSettled,
bütün çağrılar settled VE journal STOP değil anlamındadır; attempt düzeyinde
settled bir çağrı, sonraki olay journal'ı durdursa bile durumunu korur.

## Synthetic v1 ve usage

Response yalnız `{version: synthetic-v1, outputJson: string, usage}` içerir.
Ek alanlar, eksik/bozuk usage ve bilinmeyen semantik reddedilir. Bu Groq veya
başka SDK response şeması değildir. Usage alanları safe integer ve nonnegative:

- `inputTokens`: billable input.
- `outputTokens`: dahil bayrağı true ise reasoning dahil billable output;
  false ise reasoning hariç output.
- `reasoningTokens`: reasoning miktarı. True iken output'tan büyük olamaz.
- `totalTokens`: input + billable output.
- `reasoningIncludedInOutput`: zorunlu gerçek boolean, coercion yok.

False için billable output = outputTokens + reasoningTokens; true için
outputTokens aynen alınır. Normalleştirilmiş LP2 kaydında reasoning output'a
dahildir, tekrar eklenmez. Sentetik v1 maliyetinde reasoning output ile aynı
sentetik fiyatı kullanır. Bu varsayım gerçek sağlayıcı faturası için onay değildir.
Taşma/tutarsızlık/bilinmeyen usage => null, LP2 UNKNOWN/STOP ve kalite yayını yok.

## Ayrıştırma ve repair güvenliği

Ham output UTF-8 sınırı 64 KiB; sınır aşımında parse/repair yapılmaz, STOP.
Tam JSON parse kullanılır; markdown temizleme, substring çıkarma veya sessiz
kurtarma yoktur. LP1 schema/capability/permission/safety zinciri aynen kullanılır.
Çıktı asla çalıştırılmaz ve oracle kopyalanarak cevap üretilmez.

Repair yalnız JSON/envelope/DSL schema hataları veya açık allowlist'teki
`missing_required_parameter` / `invalid_parameter_value` içindir. Strict response
envelope bozuksa usage güvenilir sayılmaz, repair yerine muhasebe STOP olur;
buradaki envelope repair ifadesi LP1 cevap envelope'una aittir.
Anlamsal yanlışlık otomatik repair tetiklemez; kalite FAIL olarak ölçülür.
Unsupported/refusal beklenirken plan, bilinmeyen capability, riskli eylem,
onay/izin atlatma, safety ihlali repair'e izin vermez. Şema bozuk olduğunda bile
raw plandaki type alanları konservatif olarak registry ile taranır; riskli veya
bilinmeyen type ile başarısız score STOP'tur. Bu false-positive üretebilir;
canlı kullanıcı davranışı değildir ve güvenli tarafta kalmak için seçilmiştir.

Preflight provisional tanı üretir; ilk çağrının durable settle işlemini LP2
tamamlamadan ikinci callback başlayamaz. Safety STOP, geçerli usage settle
sonrası uygulanır; böylece kullanım kaybolmaz, repair=0 ve kalite yayını=false.
LP2 en fazla bir repair, aynı provider/model/config, 20 saniye call timeout,
ortak 45 saniye deadline ve concurrency=1/retry=0 sınırlarını aynen uygular.
Geç sonuç run raporunu veya rezervasyonları sonradan değiştiremez.

## Paydalar ve yeniden başlatma

`summarizeB2C(schedule, results)` açık plan listesini zorunlu alır. Eksik result
satırı bile schedule'dan oluşturulur, gizlice paydadan düşmez. Eksik satır
attempted=false, accountingSettled=false, qualityPublished=false,
qualityStatus=not_scheduled_yet olur ve skippedUnavailable sayısına girer.
Plan dışı sonuç,
model/case duplicate, run ID duplicate ve kategori/split/family uyuşmazlığı reddedilir.
Her model/category/split/family için scheduled, attempted, accounting settled,
quality evaluated, skipped/unavailable ve coverage ayrı raporlanır.
Coverage = quality evaluated / scheduled; boş schedule için null. Kalite oranları
yalnız yayımlanmış sonuçlarla hesaplanır; ilk ve final ayrı LP1 özetlerine girer.
Kalite FAIL de değerlendirme paydasına girer. Safety STOP ayrıca diagnostic
sayaçtır; dışlanan run'lar sessizce iyi model kalitesi izlenimi yaratmamalıdır.
Global LP2 rezervasyon/call/token/microUSD muhasebesi bu oranlara karıştırılmaz.

Crash replay veya daha önce kaydedilmiş aynı run yeniden dispatch etmez.
Pending journal => STOP ve kalite yok. Bütün çağrılar settled fakat bellek içi
output kayıp => accounting settled / quality unavailable_after_restart.
Muhasebe journal'ına ham çıktı, prompt, kişisel veri veya exception metni eklenmez.
Run ID'ler caller'ın sağladığı gizli olmayan sentetik etiketlerdir; bu fazda
case/model mapping ve quality receipt kalıcı değil, caller schedule sözleşmesidir.
Gerçek kalıcı rapor/receipt ve kimlik bağlama gelecekte ayrı güvenlik çalışmasıdır.

## Test kanıtı ve sınırlar

Yeni bridge testleri 35/35 PASS; TypeScript build PASS. İlk ek testte pil
registry'sinde `level` alanı required sanılmıştı; mevcut validator davranışı
doğrulandı ve test güvenli DSL schema hatasına çevrildi. LP1/registry değiştirilmedi.
Tam backend regresyonu 963/963 PASS, 44 test dosyası (önceki 928 + 35 yeni).
Önceden mevcut untracked auth-server dosyasının 5 testi bu toplamda yer alır;
dosya değiştirilmedi. Mevcut localhost mock testleri için yerel port izniyle
tam regresyon çalıştırıldı; dış AI sunucusuna bağlanılmadı. Testler kendi mkdtemp dizinleri
ve sentetik çıktıları dışında veri kullanmaz. Ham çıktı ve gizli alanların
journal'a girmediği de kontrol edilir. Gerçek API çağrısı 0.

Bağımsız fresh-reader incelemesi muhasebe/kalite ayrımını, usage formülünü,
repair güvenliğini ve coverage paydasını doğru okudu. Eksik sonuç sınıflandırması
ve yayın koşulu bu inceleme sonrası açıklaştırıldı.

Açık işler: gerçek SDK bridge/usage/upper bound, provider koşulları ve ödeme
yetkisi, durable output receipt, operator recovery ve rollback koruması,
RH-02/RH-07, P3/P4. Hiçbiri bu offline test sonucu ile kapanmış değildir.
