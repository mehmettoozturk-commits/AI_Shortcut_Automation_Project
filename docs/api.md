# `POST /plan` API — Phase 4A

Bu doküman kod içermez; `src/api/contract.ts` (şekil) ve
`src/api/server.ts` (implementasyon) dosyalarının **neden** böyle
tasarlandığını anlatır — DSL/registry ikilisi için `docs/capabilities.md`
ne yapıyorsa, bu da API sınırı için onu yapar.

## 0. En önemli cümle

**Bu bir "AI backend" değil.** `POST /plan`, mevcut (Phase 2'den beri
var olan, kural tabanlı) `NluPipeline`'ı HTTP'nin arkasına koyar.
Değişen şey NİYET/ENTITY ÇIKARIMININ NASIL yapıldığı değil — sözleşme,
doğrulama zinciri ve durum yönetimi zaten gerçek. Phase 4B'nin tek işi
`RuleBasedIntentExtractor`'ı gerçek bir LLM `IntentExtractor` ile
DEĞİŞTİRMEK olacak; bu dosyanın hiçbiri o değişiklikle bozulmayacak
şekilde tasarlandı.

## 1. Neden ayrı bir "gölge şema" değil

`src/api/contract.ts`, `src/nlu/types.ts`'teki gerçek
`PlanningOutcome`/`ConversationContext`/`IntentResult` tiplerinin
BİREBİR Zod karşılığıdır. API'ye özel, basitleştirilmiş bir DTO şekli
İCAT EDİLMEDİ — iki şekil zamanla birbirinden kayar, hangisinin
"doğru" olduğu belirsizleşir. Bunun yerine `PlanResponseSchema`
`PlanningOutcome`'un dört durumunu (`plan`/`needs_clarification`/
`unsupported`/`not_understood`) `discriminatedUnion` ile birebir
yansıtır.

## 2. Neden durumsuz (stateless)

Sunucu hiçbir konuşma durumu SAKLAMAZ. İstemci, bir önceki yanıttaki
`conversation` alanını bir sonraki istekte AYNEN geri gönderir; sunucu
onu geçici olarak "hydrate" eder, işler, güncellenmiş hâlini yanıtta
geri verir. Bu bilinçli bir tercih:

- Yatay ölçeklenebilirlik (herhangi bir sunucu örneği herhangi bir
  isteği işleyebilir — session affinity gerekmez).
- Test edilebilirlik (bir konuşmayı yeniden oynatmak için sadece
  önceki `conversation` JSON'unu saklamak yeterli).
- İstemci mimarisiyle tutarlılık: `BuilderMachine` zaten kendi
  durumunu (`DraftAutomationPlan`) taşıyor; NLU'nun AYRICA kendi
  sunucu-taraflı oturumunu tutması gereksiz bir ikinci doğruluk
  kaynağı yaratırdı.

## 3. `plan()` vs `answerClarification()` yönlendirmesi

`NluPipeline`'ın İKİ giriş noktası var: `plan(text, ctx)` (yeni bir
istek/düzeltme) ve `answerClarification(answer, ctx)` (bekleyen bir
soruya cevap). `BuilderMachine` bunları hiç görmez — `NluPlannerAdapter`
(Phase 1 `Planner` portu için) `missing_info`'yu TAMAMEN client-side
kendi state machine'inde çözer, NLU'ya geri dönmez.

Ama `POST /plan`'ın kendisi client-agnostic bir sözleşme — bir sonraki
turun "yeni bir istek mi yoksa bekleyen soruya cevap mı" olduğunu
sunucu kendisi ayırt etmek zorunda. Kural: bir önceki yanıtın
`conversation.lastMissingField` alanı doluysa, gelen `text`
`answerClarification()`'a gider; aksi halde `plan()`'a (düzeltmeler
dahil — `NluPipeline` "modify_automation" niyetini kendisi ayırt
eder, bkz. `tests/nlu-contract.test.ts`).

## 4. Doğrulama zinciri ne zaman çalışır

Yalnızca `status: "plan"` olduğunda — eksik bilgi varken veya
desteklenmeyen bir istekte doğrulanacak TAM bir plan yoktur. O anda
`DraftAutomationPlan` (eksik alanlar içerebilir) önce `AutomationPlan`
şekline (dsl/schema.ts) daraltılır, sonra `runValidationPipeline`
(Schema → Capability → Permission → Safety, `src/validators/pipeline.ts`
— Phase 1'den beri var, değişmedi) ile doğrulanır. Sonuç yanıta
`validation` alanı olarak eklenir; istemci `ok: false` görürse
kullanıcıya izin/güvenlik uyarısı gösterebilir.

Sunucunun ÜRETTİĞİ yanıt da kendi sözleşmesine (`PlanResponseSchema`)
karşı AYRICA doğrulanır — şekli garanti edilmemiş bir yanıt istemciye
asla gönderilmez; bu bir implementasyon hatasını (500) gösterir,
kullanıcı girdisiyle ilgili değildir.

## 5. Neden Node'un yerleşik `http` modülü

Proje şu ana kadar tek bir runtime bağımlılığı (`zod`) taşıyor. Tek
endpoint için Express gibi bir çerçeve eklemek bu noktada gerekli
değil — `server.ts`'teki manuel routing/body-parse, tek endpoint için
kabul edilebilir miktarda kod. Endpoint sayısı gerçekten artarsa bu
karar yeniden değerlendirilebilir; şimdiden o karmaşıklığı almadık.

## 6. Kapsam dışı (bilinçli olarak Phase 4B/4C'ye bırakıldı)

- **Swift/iOS istemcisi (`HTTPBackedPlanner`).** Bu round yalnızca
  backend'i kurdu; iOS tarafında hâlâ `MockPlanner` kullanılıyor.
  Phase 4C'nin konusu.
- **CORS, kimlik doğrulama, rate limiting** — yerel/dev kullanım için
  gerekli değil; gerçek bir dağıtım öncesi ayrıca ele alınmalı.

(Bu bölümde daha önce listelenen "gerçek LLM çağrısı" ve "LLM JSON
hatası → retry" maddeleri Phase 4B'de kapatıldı — bkz. §8.)

## 7. Test kapsamı

- `tests/api-contract.test.ts` — şema doğrulama, GERÇEK `NluPipeline`
  çıktılarıyla round-trip (uydurma fixture değil).
- `tests/api-server.test.ts` — sunucu ephemeral bir portta GERÇEKTEN
  başlatılıp `fetch` ile konuşulur: net cümle → plan + `validation.ok`,
  izin eksikliği → `validation.ok: false`, eksik bilgi →
  `needs_clarification`, desteklenmeyen eylem → `unsupported`
  + alternatifler, çok turlu konuşma (clarification → cevap → plan),
  hatalı istek → 400, bilinmeyen yol → 404.

`npm run serve` ile sunucu `http://localhost:3000/plan`'da elle de
denenebilir.

## 8. Phase 4B — gerçek LLM sağlayıcısı (2026-09-19)

### 8.0 En önemli cümle

Mevcut senkron `IntentExtractor`/`EntityExtractor`/`NluPlanner`
arayüzleri (`src/nlu/ports.ts`) **DEĞİŞMEDİ** — hâlâ senkron, hâlâ 221
Phase 1-4A testi hiçbir satır değişmeden yeşil. Bunun yerine PARALEL,
YENİ bir async sınır eklendi: `NluProvider.plan(input, context):
Promise<IntentResult>`. `NluPipeline` artık iki giriş noktası taşıyor:
senkron `plan()` (değişmedi, varsayılan `RuleBasedIntentExtractor`'ı
kullanır) ve async `planAsync()` (yeni, varsayılan `RuleBasedProvider`
— aynı kural tabanlı mantığın async sarmalayıcısı — veya gerçek bir LLM
sağlayıcısı, `ClaudeIntentProvider`, kullanır). İkisi de niyet
üretildikten SONRAKİ mantığı (`continueFromIntent` — düzeltme mi/yeni
plan mı, eksik bilgi var mı) AYNI private metotta paylaşır; bu yüzden
testler ve production tek bir boru hattını paylaşıyor, iki ayrı
implementasyon yok.

`POST /plan` artık `pipeline.planAsync()` çağırır (`answerClarification`
hâlâ senkron — aşağıya bkz., §8.3).

### 8.1 Neden yeni bir arayüz, mevcutları async yapmak yerine

`IntentExtractor.extract()`'ı `Promise<IntentResult>` döndürecek şekilde
değiştirmek, onu doğrudan senkron çağıran ~30 test bloğunu (dört test
dosyasına yayılmış) `async`/`await`'e çevirmeyi gerektirirdi — mekanik
ama geniş, riskli bir değişiklik. Yeni bir `NluProvider` arayüzü
eklemek, mevcut sözleşmeyi kırmadan (kural tabanlı sağlayıcının kendi
doğrudan testleri hiç dokunulmadan geçer) aynı hedefe ulaşır: kural
tabanlı VE LLM sağlayıcısı aynı async sınırdan geçer.

### 8.2 LLM'in ÜRETTİĞİ şey ve KESİNLİKLE ÜRETMEDİĞİ şey

`ClaudeIntentProvider` (`src/nlu/providers/claude-provider.ts`),
Anthropic TypeScript SDK'sının `client.messages.parse()` +
`output_config: { format: zodOutputFormat(schema) }` desenini kullanır
(serbest metin DEĞİL, `response.parsed_output` doğrudan tipli/doğrulanmış
JSON). Şema (`LlmPlanOutputSchema`) şu şekli zorunlu kılar:

```json
{
  "intent": "create_automation",
  "trigger": { "semantic": "vehicle_departure" },
  "steps": [{ "semantic": "vehicle_sentry_mode" }],
  "entities": [{ "name": "vehicle", "value": "Tesla Model Y" }],
  "missing": []
}
```

**Değişmez (bu projenin tamamında tekrarlanan kural):** LLM'e verilen
sistem promptu, registry'den yalnızca `semantic`/`kind`/`description`
alanlarını okuyarak türetilmiş bir katalog içerir
(`buildSemanticCatalog()`, `src/nlu/providers/llm-schema.ts`) —
capability id'leri (`id` alanı) LLM'e **prompt/context olarak dahi
verilmez**. Bu, tek bir yerde elle uyulan bir kural değil,
`tests/nlu-contract.test.ts`'teki statik kaynak taramasıyla
(capability id'lerinin `src/nlu/providers/*.ts` dosyalarında
geçmediğini doğrular) ve `tests/llm-provider.test.ts`'teki çalışma
zamanı testleriyle kilitli.

### 8.3 Neden `answerClarification` hâlâ senkron

Bekleyen bir soruya verilen cevaptan (`"Tesla Model Y."` gibi) entity
çıkarmak, LLM gerektirmeyen, saf regex tabanlı bir iş
(`RuleBasedEntityExtractor`) — bunu async bir sınırın arkasına almak
gereksiz karmaşıklık katardı. Yalnızca YENİ bir isteğin/düzeltmenin
NİYET SINIFLANDIRMASI (`plan`/`planAsync`) LLM sınırından geçer.

### 8.4 Çok turlu bağlam LLM'e nasıl aktarılır (capability id sızdırmadan)

"Arabadan inince klimayı aç." → "Hangi araç?" → "Tesla Model Y." →
"Hayır, Model 3." senaryosunda üçüncü tur, `intent: "modify_automation"`
sınıflandırmasını gerektirir. Bunun için LLM'e önceki turların METNİ ve
`context.lastIntent` (ÖNCEKİ turun SEMANTİK `IntentResult`'ı — trigger/
steps zaten semantik isim taşır, capability id DEĞİL) ipucu olarak
verilir; `context.currentPlan`'daki ÇÖZÜLMÜŞ capability id'leri
(`plan.trigger.type` gibi) LLM'e ASLA verilmez. Düzeltme algılandıktan
sonra asıl revizyonu (yalnızca aracın değişmesi, tetikleyici/eylemin
korunması) hâlâ registry-farkında olmayan, kural tabanlı
`DefaultPlanRevisionEngine` yapar — bu, Phase 2'den beri değişmedi.

Bu akış hem sahte bir sağlayıcıyla (`tests/pipeline-async.test.ts`) hem
de gerçek, çalışan bir HTTP sunucusuna karşı (kural tabanlı varsayılan
sağlayıcıyla, `npm run serve` + üç ardışık `curl` isteği) elle
doğrulandı: üçüncü turda yalnızca `plan.trigger.device` değişiyor,
`plan.trigger.type` ve `plan.steps` AYNEN korunuyor.

### 8.5 Hata ayrımı: `provider_error` vs `unsupported`/`not_understood`

`PlanningOutcome`'a (ve `PlanResponseSchema`'ya) yeni bir durum eklendi:
`provider_error` (LLM ağ hatası, geçersiz/şemaya uymayan JSON).
Bilinçli olarak `not_understood` ile BİRLEŞTİRİLMEDİ — `not_understood`
sağlayıcının BAŞARIYLA çalışıp "bu niyeti tanımadım" dediği geçerli bir
sonuçtur; `provider_error` sağlayıcının HİÇ çalışamadığını gösterir.
HTTP'de bu ayrım durum koduna da yansır: `provider_error` → 502, diğer
üç durum (`plan`/`needs_clarification`/`unsupported`/`not_understood`)
→ 200 (kendi `status` alanlarıyla ayırt edilir).

### 8.6 API anahtarı

`.env` zaten `.gitignore`'da; anahtar hiçbir satırda hardcode edilmedi.
`serve.ts`, `LLM_API_KEY` (sağlayıcı-bağımsız, ileride başka bir LLM'e
geçilirse isim değişmesin diye) veya `ANTHROPIC_API_KEY` (SDK'nın kendi
standart ismi) runtime environment'ta varsa `ClaudeIntentProvider`'ı,
yoksa (açıkça loglayarak) kural tabanlı varsayılanı kullanır. Bu
ortamda ikisi de tanımlı değildi; bu yüzden gerçek bir LLM çağrısının
uçtan uca doğrulaması YAPILMADI — yalnızca sahte (`ClaudeMessagesClient`
enjekte edilen) istemciyle şema/eşleme mantığı doğrulandı
(`tests/llm-provider.test.ts`). Gerçek bir anahtarla `npm run serve`
çalıştırılıp aynı üç `curl` turu tekrarlanarak bu doğrulama
tamamlanabilir.

### 8.7 Test kapsamı (Phase 4B eklentisi)

- `tests/pipeline-async.test.ts` — `planAsync()`'in varsayılan
  sağlayıcıyla senkron `plan()` ile birebir aynı sonucu ürettiğini,
  kilitli çok turlu senaryoyu ve sağlayıcı hatasının ayrı bir durum
  olarak döndüğünü doğrular.
- `tests/llm-provider.test.ts` — semantik katalogun capability id
  içermediğini, `ClaudeIntentProvider`'ın yapılandırılmış çıktıyı
  doğru eşlediğini, geçersiz/şemasız çıktıda ve ağ hatasında
  `LlmProviderError` fırlattığını (sahte istemciyle, ağ çağrısı
  YAPMADAN) doğrular.
- `tests/api-server.test.ts`'e eklenen test — enjekte edilmiş bir
  başarısız sağlayıcıyla gerçek bir HTTP isteğinin 502 +
  `status: "provider_error"` döndürdüğünü doğrular.
- `tests/nlu-contract.test.ts`'teki statik hardcode taraması artık
  `src/nlu/providers/*.ts` dosyalarını da kapsıyor.
