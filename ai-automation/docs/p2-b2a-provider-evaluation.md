# P2-B2A — Yerel provider değerlendirme altyapısı

Başlangıç: `108d28176a6b3add83ea8ce688daf1eb83d10a11`.
Kapsam: yalnız yerel kod, deterministik mock testler ve bu doküman.
Bu rapor model seçimi, üretim kalitesi veya gerçek cihaz kurulumu onayı değildir.

## Çalıştırma ve dosyalar

Projenin `ai-automation` dizininde, `.env` yüklemeden:

```sh
node --import tsx scripts/evaluate-providers-mock.ts
npx vitest run tests/provider-evaluation.test.ts
npm run build
npm test
```

CLI stdout'a yalnız özet ve başarısız senaryo ID/kontrol adlarını yazar;
başarısız senaryo varsa exit code 1 verir. Rapor otomatik diske yazılmaz.

Yeni dosyalar (mevcut kaynak dosyaları değiştirilmedi):

- `src/evaluation/types.ts`: senaryo ve beklenen sonuç sözleşmeleri.
- `src/evaluation/turkish-cases.ts`: 104 Türkçe senaryo fabrikası.
- `src/evaluation/cost.ts`: yapılandırılabilir, tarih/kaynak içeren fiyat varsayımları.
- `src/evaluation/runner.ts`: yalnız bellekte mock SDK sınırı ve metrik toplama.
- `scripts/evaluate-providers-mock.ts`: ağsız, anahtarsız CLI.
- `tests/provider-evaluation.test.ts`: 122 yeni test.
- `docs/p2-b2a-provider-evaluation.md`: bu rapor.

## Gerçekte ne değerlendiriliyor?

78 NLU senaryosu mevcut `OpenAICompatibleIntentProvider` içine enjekte edilmiş
bellek içi istemciyi, değişmemiş `LocalFirstProvider` ve `NluPipeline` ile kullanır.
SDK nesnesi oluşturulmaz; anahtar/env okunmaz; HTTP transport bulunmaz.
JSON ayrıştırması, mevcut LLM şeması, semantic completeness ve tek repair yolu
gerçek uygulama kodudur; sağlayıcı yanıtları ise elle yazılmış fixture'lardır.
Her senaryo kendi pipeline, script sayacı, AbortController ve provenance kaydını alır.

Planlar mevcut API'nin taslak→DSL dönüşümüyle aynı şekilde (`device: null` →
`undefined`) doğrulama zincirine girer. Üretim API kodu değiştirilmemiştir.
Beklenen trigger, yüzde, karşılaştırma yönü, step listesi, soru kimliği, hata
kodu ve çağrı sayısı fixture yanıtından otomatik türetilmez; bağımsız karşılaştırılır.

26 senaryo yalnız DSL doğrulayıcı fixture'ıdır: çok adımlı akış ve onaysız riskli
eylem. Bunlar Türkçe anlama veya prompt-injection dayanıklılığı kanıtı DEĞİLDİR.
Kullanıcı metni bu alt grupta açıklayıcı bağlamdır; model tarafından yorumlanmaz.
Mevcut schema/capability/permission/setup/safety zinciri değiştirilmeden çalışır.
Bugünkü registry'de app-owned izin bulunmayan akışlar için boş izin listesi
geçerlidir; dış Kestirmeler/Tesla kurulum gereksinimleri izin verilmiş sayılmaz.
Ek test, mevcut permission-validator lookup seam'i ile gelecekteki app-owned
izin reddinin bloklandığını sınar; registry'ye yeni izin/capability eklemez.

## Veri seti ve kategori sonuçları — mock/simulated

| Kategori | Sayı | Beklenen sonuç | PASS |
| --- | ---: | --- | ---: |
| Basit | 13 | Pil altına düşünce geçerli yerel bildirim planı | 13 |
| Parametreli | 13 | Pil üstüne çıkınca yüzde/yön korunmuş yerel plan | 13 |
| Eksik bilgi | 13 | Saat sorusu | 13 |
| Desteklenmeyen | 13 | Uydurma yetenek çalıştırılmaz, unsupported | 13 |
| Çok adımlı | 13 | Onay ve koşullu dallı DSL doğrulanır | 13 |
| Güvenlik | 13 | Onaysız riskli DSL reddedilir | 13 |
| Belirsiz | 13 | Sabah/akşam sorusu | 13 |
| Bozuk çıktı | 13 | JSON/schema hatası ardından tek repair ile geçerli plan | 13 |

104 farklı metin/ID vardır. Parametre matrisi %1..%99 aralığında 13 seçilmiş
eşik içerir. Bu bilinçli, dar bir regresyon veri setidir; 104 bağımsız dilsel
yetenek, kapsamlı çok adımlı dil anlama veya gerçek model benchmark'ı değildir.

## Metrik tanımları ve örnek sonuç

Tüm çıktılar `mode: mock/simulated` taşır. Oranlar 0..1, paydası olmayan oran null'dır.

- **Schema validity:** ayrıştırılabilir LLM yanıtları + üretilen DSL şema
  denemeleri birlikte: **117/130 = %90**. 13 kasıtlı bozuk ilk yanıt da paydada
  tutulur. Capability/permission/safety reddi şema bozukluğu değildir.
  Kırılım: 65 mock LLM yanıtının 52'si şemaya uygun; 65 DSL denemesinin
  tamamı şemaya uygundur (39 NLU sonrası plan + 26 doğrudan DSL fixture'ı).
- **Capability correctness:** çözümlenmiş plan veya unsupported sonucu olan
  uygulanabilir 78 örnek üzerinde capability varlığı/türü/platformu ve varsa
  açık trigger/parametre/step oracle'ları: **78/78**. Açıklama soruları dışarıda.
  Şimdilik unsupported eylemlerin ayrıntılı gerekçe eşdeğerliği ölçülmez.
  Payda: basit, parametreli, desteklenmeyen, çok adımlı, güvenlik ve bozuk
  çıktı kategorilerinin her birinden 13; bu 78 sayısı NLU katmanı sayısıyla
  tesadüfen aynıdır, aynı örnek kümesi değildir.
- **Clarification accuracy:** her senaryoda soru gerekip gerekmediği, gerektiğinde
  doğru soru ID'si: **104/104**. Pozitif soru örneği 26'dır; metin üslubu ölçülmez.
- **Repair success:** iki mock çağrı yapılan örneklerde sonucun oracle'ları
  karşılayan geçerli plan olması: **13/13**. Başarısız ikinci yanıt ayrı testte
  başarı sayılmadığı doğrulanır. Genel metrik henüz clarification/unsupported'a
  repair'i başarı olarak saymaz; plan-repair metriğidir.
- **Safety violation count:** güvenlik oracle'ının reddedilmesini istediği bir
  planın kabul edilmesi: **0**. 13 tehlikeli fixture güvenli biçimde reddedildi.
  Bu ölçüm bilinmeyen saldırıları keşfeden bağımsız güvenlik denetimi değildir.
- **Provider invocation count:** **65 mock SDK-sınırı çağrısı**; 26 yerel NLU
  senaryosunda sıfır. DSL fixture'ları da çağrı yapmaz. P2-A provenance sayacıyla
  eşleşme test edilir. **Gerçek API çağrısı 0; gerçek anahtar kullanımı 0.**
- **Süre:** yerel wall-clock ortalama ve nearest-rank P95. Örnek CLI koşusunda
  **0,132 ms ortalama / 0,415 ms P95**; makine/yükle değişir, gerçek model
  gecikmesi veya SLA değildir. Formül ayrıca deterministik saatle test edilir.

## Maliyet simülasyonu

Fiyat varsayımları `cost.ts` içinde değiştirilebilir; her biri model, USD/milyon
giriş/çıkış token fiyatı, tarih ve kaynak içerir. Snapshot tarihi **2026-10-15**;
kaynak: <https://console.groq.com/docs/models>. Bu tarihli varsayımlar gelecekte
aktivasyon öncesinde yeniden doğrulanmalıdır; canlı fiyat sorgusu yapılmaz.

Giriş token tahmini gerçek mock çağrı parametrelerinin JSON metni üzerinden
Unicode karakter/4 (yukarı yuvarlama) sezgisidir: sistem promptu, şema, bağlam
ve repair metni dahil. Çıkışta dönen fixture karakterleri/4 kullanılır.
Transport hatasında dönen metin olmadığı için çıkış tahmini sıfırdır; bu,
gerçek timeout/iptalin ücretsiz veya faturalandırılmamış olacağı anlamına gelmez.
Reasoning, SDK usage, görünmeyen server çalışması, vergi ve Render dahil değildir.

Formül: `(inputTokens × inputPrice + outputTokens × outputPrice) / 1_000_000`.
Repair varsa her çağrı ayrı dahil edilir; ayrıca %10 çarpanı uygulanmaz.

104 senaryonun mock raporu: 73.003 giriş / 2.575 çıkış tahmini token.

| Fiyat varsayımı | Giriş / çıkış USD/milyon | Simülasyon toplamı |
| --- | --- | ---: |
| Groq GPT-OSS 20B | 0,075 / 0,30 | $0,006247725 |
| Groq GPT-OSS 120B | 0,15 / 0,60 | $0,01249545 |

Bu iki satır **aynı mock çıktılarının iki farklı fiyatla çarpımıdır**; iki modelin
gerçek kalite, hız, token veya maliyet karşılaştırması değildir. Bütçe/kota kontrolü
veya faturalandırma için kullanılamaz.

## Test kanıtı ve sınırlar

- Yeni 122 test: corpusun her örneği, yanlış yüzde/yön/step ve soru oracle'ının
  yakalanması, bozuk DSL, uydurma capability, izin reddi, başarısız repair,
  simüle timeout/503/abort, script tükenmesi, paralel izolasyon, maliyet/süre
  formülleri ve ağ fetch'inin çağrılmaması.
- Tam backend regresyonu: **706/706 PASS, 39 test dosyası**; önceki 584 test
  ve 122 yeni test. Önceden var olan untracked `auth-server.test.ts` içindeki
  5 test de bu toplamda bulunur; dosyanın içeriği değiştirilmedi.
- Timeout fixture'ı anlık simüle SDK timeout hatasıdır; yeni bir gerçek SDK
  deadline testi değildir. Mevcut iptal/timeout/HTTP kapasite regresyonları
  tam backend koşusunda ayrıca korunur.
- TypeScript build: PASS. İlk sandbox koşusundaki çıktı yazma izni sorunu
  gerekli yerel derleme izniyle aşıldı; kaynak tip daraltması düzeltildi.
- İlk hedef test koşusundaki test yazım hatası düzeltildi; son hedef koşu PASS.
- Router/API/adapter/auth/entitlement/production başlangıcı değiştirilmedi.
  Router varsayılan OFF; mevcut B1 testleri tam regresyon kapsamında çalışır.
- Commit/push/deploy, gerçek provider aktivasyonu, anahtar veya ödeme yok.
- Bağımsız doküman okuyucu kontrolü: gerçek kalite/çağrı, katmanlar, metrik
  paydaları, maliyet ve yetki sınırları doğru anlaşıldı. İşaret edilen LLM/DSL
  schema ve capability payda kırılımları yukarıda açıklaştırıldı.

## OPEN / STOP

Gerçek Groq kalitesi, reasoning/token usage, fiyat/erişim ve veri işleme koşulları
B2B öncesi ayrı onay ve sınırlı bütçe gerektirir. Serbest metin kapsamı ve
holdout veri seti genişletilmelidir. P3 kota/idempotency/organizasyon bütçesi,
P4 entitlement, RH-02 ve RH-07 açık kalır. Bu modül production başlangıcından
import edilmez. P2-B2A tesliminde durulur; Git ve sonraki fazlar ayrı onay ister.
