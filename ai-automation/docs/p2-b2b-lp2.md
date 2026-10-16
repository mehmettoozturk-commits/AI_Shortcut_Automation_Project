# LP2 — Offline kalıcı bütçe ve çağrı güvenliği

Başlangıç HEAD: `94582895e377b9dac05691c6a62a63717d99f20a`.
Bu aşama yalnız **offline/mock** altyapıdır. Gerçek AI kalitesi, token tüketimi,
fatura veya production güvenliği doğrulanmış değildir. LP1 GitHub'a gönderildi;
LP2 için bu rapor hazırlanırken commit/push/deploy yapılmadı.

## Kapsam ve kararlar

| Yeni dosya | Görev |
| --- | --- |
| `src/evaluation/lp2-types.ts` | Integer bütçe, fiyat, usage ve rezervasyon sözleşmeleri |
| `src/evaluation/lp2-journal.ts` | Yerel tek sahipli append-only journal ve muhasebe |
| `src/evaluation/lp2-offline-runner.ts` | Sentetik dispatch, deadline, iptal, en fazla bir repair |
| `tests/lp2-journal.test.ts` | Disk, bütçe, replay ve sayısal sınır testleri |
| `tests/lp2-offline-runner.test.ts` | Dispatch sayaçları, süreçler, timeout, abort, repair |
| `docs/p2-b2b-lp2.md` | Bu teknik sözleşme ve kısıtlar |

LP1/B2A, API/auth/Local-First, router, mevcut provider adapter'ları ve production
başlangıcı değiştirilmez. Router varsayılan OFF kalır. Yeni modüllerden bunlara
import yoktur; production tarafından da yeni modüller import edilmez.
Gerçek SDK, HTTP istemcisi, environment okuma, API anahtarı, provider factory,
CLI aktivasyonu veya abonelik/kota bağlantısı eklenmez. Bu kullanıcı başına
P3 kotası değildir: ayrı bir değerlendirme çalışmasının global sınırlarıdır.

## Muhasebe ve durum makinesi

`NEW → RESERVED → DISPATCHING → SETTLED` normal akıştır.
Eksik/tutarsız usage veya transport belirsizliği `UNKNOWN → STOP` üretir.
Geçerli fakat rezervasyonu aşan usage journal'a actual olarak yazılır, ardından
STOP uygulanır; başarılı/limit içinde kabul edilmez. STOP geri alınamaz.

Rezervasyon, çağrı başına açık input/output üst sınırlarıyla hesaplanır. Her iki
token sınırı toplam token rezervasyonuna girer; ayrı input ve output fiyatlarıyla
tavan micro-USD hesaplanır. Fiyatlar **sentetik test varsayımıdır**, güncel Groq
fiyatı değildir. `priceOf` BigInt ara işlemler ve yukarı yuvarlama kullanır;
dış sözleşmede safe integer micro-USD tutulur. Negatif, kesirli, NaN/Infinity ve
taşan değerler reddedilir. Reasoning, output'a dahil olarak açıkça doğrulanır;
reasoning output'tan büyük olamaz ve total=input+output olmalıdır. Böylece
reasoning iki kez sayılmaz; bu sözleşmeye uymayan usage belirsiz kabul edilir.

Pilot için önerilen offline limit sabiti: 360 çağrı, 2.000.000 token ve
5.000.000 micro-USD ($5). 340 planlama hedefidir; kalan 20 çağrı gerçek harcama
izni değildir. Testler daha küçük bağımsız cap'ler de kullanır. Çağrı/token/USD
limitlerinden herhangi biri aşılacaksa durable STOP yazılır ve dispatch olmaz.
`totals().calls` reserve sayısıdır; gerçek SDK invocation metriği değildir.
Aktif rezervasyonlar toplamda tam olarak sayılır. Geçerli usage ile yalnız
kullanılmayan token/USD payı serbest kalır; çağrı sayacı asla geri alınmaz.

Tokenizer tahmini veya gelecekteki provider faturası garanti edilmez. Gerçek
aktivasyon öncesinde input/context üst sınırlarının güvenilirliği, maximum output,
reasoning fiyat politikası, vergi/yuvarlama ve sağlayıcı harcama koruması ayrıca
doğrulanmalıdır. Offline limit kontrolü tek başına $5 gerçek fatura garantisi değildir.

## Disk ve sahiplik sınırı

Çağıran önceden oluşturduğu özel yerel dizini verir. `lp2.lock` atomik `wx`
ile alınır; lock dosyası ve dizin metadata'sı fsync edilir. İkinci süreç veya
stale lock varsa çalışma başlamaz. Journal dosyası yeni oluşturulmuşsa header
fsync ve dizin fsync yapılır. Header; version, model/config kimliği, sentetik
fiyat ve limitleri sabitler. Başka ayarlarla yeniden açmak reddedilir.

Her satır sıra numarası, önceki hash, olay ve SHA-256 içerir. JSON encoding,
yazılan property sırasıdır; ayrı canonicalization iddiası yoktur. Satır zinciri
ve durum geçişleri replay'de denetlenir. Yarım, boş veya bozuk journal otomatik
truncate, onarım veya yeniden oluşturma görmez. Hash zinciri yanlışlıkla
bozulmayı yakalar; dosyayı yeniden yazabilen saldırgana karşı MAC değildir.

Her reserve ve dispatch kaydı ayrı write+fsync tamamlandıktan sonra sentetik
provider çağrılır. Kısmi write döngüyle tamamlanır; write/fsync başarısızsa STOP
ve sahiplik kilidi korunur. Yazımın kendisi başarısızken STOP'un ayrıca diske
yazıldığı iddia edilmez: bellekte STOP ve tutulmuş lock yeniden dispatch'i engeller.
Bu nedenle diske düşmüş gibi görünen ama kalıcılığı
kanıtlanamayan settle satırı, normal yeniden başlatmayla güvenilir sayılmaz.
Normal `close()` yalnız kendi kilidini kaldırır ve dizini fsync eder; I/O hatası
sonrası kilidi kaldırmaz. Crash lock'u otomatik temizlenmez.

Journal tek yerel dosya sistemi ve tek güvenilir süreç içindir. NFS/paylaşımlı
disk, çok sunucu, kötü niyetli yerel dosya değiştirme, disk rollback/backup
resurrection ve güç kesintisi/donanım write-cache garantileri kapsam dışıdır.
Testler fsync sıralaması/hatasını ve süreç çıkışını sınar; fiziksel güç kesintisini
kanıtlamaz. Dosya sahibi dizin/lock'u çalışma sırasında değiştirmemelidir.

## Crash, idempotency ve hata davranışı

Reserve veya dispatch sonrası sonuçlanmamış kayıt bulunan replay global STOP
olur, rezervasyon tam korunur. Aynı run/call ID ikinci kez gönderilemez.
Stale lock otomatik kırılmaz. Uygulamada unlock, refund veya yeniden gönderim
API'si yoktur. Gelecekte ayrı denetlenebilir bakım prosedürü gerekir. Testlerde
operator unlock yalnız izole geçici dizinde emüle edilir; ardından incomplete
kayıt yine STOP üretir. Bozuk kayıt da inceleme için olduğu gibi bırakılır.

Timeout, abort, network, 429 ve 5xx çağrının uzakta işlenmediğini kanıtlamaz;
tam rezervasyon tutulur, retry=0, belirsiz ilk çağrıdan sonra repair=0.
Geç gelen başarılı sonuç rezervasyonu otomatik serbest bırakmaz. Geçersiz usage
ham provider payload'ı yerine null olarak kaydedilir: bilinemeyen actual
uydurulmaz. Geçerli fazla kullanımda bildirilen sentetik usage sayaçları muhafaza edilir;
bu doğrulanmış gerçek fatura demek değildir.

## Sentetik yürütücü

`runLP2Offline` yalnız test harness'in verdiği `offline/mock` sözleşmesini alır.
Aynı provider nesnesi, yakalanmış call metodu, model/config kimliği kullanılır;
repair öncesi görünür model/config değişimi STOP'tur. En fazla bir repair vardır;
ayrı reserve/dispatch ve ortak, en çok 45 saniyelik monotonic deadline kullanılır.
Çağrı timeout'u en çok 20 saniye, concurrency=1, otomatik retry=0'dır.
Senkron disk I/O sonrası deadline/abort tekrar kontrol edilir. Geçerli ilk usage
bilinmeden repair başlatılmaz. İkinci çıktı da repair isterse üçüncü çağrı yapılmaz;
usage settle edilir, pilot durur ve runner `stopped` döner.

Bu bir transport sandbox'ı değildir: dışarıdan verilen keyfi JavaScript callback'in
ağa çıkmasını teknik olarak engellemez. Bu aşamada tüm callback'ler testte
elle yazılmış sentetik scriptlerdir; gerçek SDK/transport enjekte etmek yasaktır.
LP1 semantic scorer ile gerçek model response bridge'i bu fazda birleştirilmez.
Runner'ın `settled` sonucu yalnız muhasebe adımını ifade eder, otomasyonun
semantik doğruluğu, güvenliği veya kurulumu anlamına gelmez.

## Doğrulama ve açık işler

TypeScript build PASS. Yeni hedefli testler **60/60 PASS** (36 journal + 24 runner).
Tam backend regresyonu **928/928 PASS, 43 test dosyası**: önceki 868 + 60 yeni test.
Önceden var olan untracked `auth-server.test.ts` içindeki 5 test toplamda yer alır;
dosya değiştirilmedi. Tam regresyondaki mevcut localhost mock sunucu testleri için
sandbox dışı yerel port izni kullanıldı; gerçek sağlayıcı çağrısı yoktur.
Testler izole `mkdtemp` dizinleri kullanır;
yalnız kendi geçici test verilerini temizler, kullanıcı/production verisine dokunmaz.
İki ani süreç çıkışı testi ve ayrı OS sürecinin canlı kilidi alamama testi de PASS.
Bağımsız doküman okuyucu offline/production ayrımını, crash muhasebesini, repair
sınırlarını ve `settled` anlamını doğru okudu; STOP kalıcılığı ve usage kanıtı
ile ilgili iki ifade bu inceleme sonrasında netleştirildi.

Zorunlu riskler: gerçek provider kullanım sözleşmesi ve üst sınırları, gerçek
usage/billing normalizasyonu, operator recovery prosedürü, production depolama,
RH-02 proxy trust, RH-07 privacy/backup, P3 ve P4 ayrı onay ve çalışma gerektirir.
Gerçek API veya production aktivasyonu bu dokümanla yetkilendirilmez.
