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

- **Gerçek LLM çağrısı.** `IntentExtractor`/`EntityExtractor`
  arayüzleri (`src/nlu/ports.ts`) SENKRON (`extract(): IntentResult`,
  Promise değil). Gerçek bir LLM sağlayıcısı ağ I/O'su gerektireceği
  için bu imzaların ASYNC olması gerekecek — bu, `NluPipeline.plan()`
  ve `NluPlanner` arayüzüne kadar yayılan gerçek bir refactor.
  Bilinçli olarak Phase 4A'da yapılmadı (henüz gerekmiyor, kural
  tabanlı çıkarım tamamen senkron).
- **"LLM geçersiz JSON üretirse retry/clarification" davranışı** —
  4B'nin konusu; 4A'nın mekanizması (şema doğrulama, hata yanıtları)
  zaten hazır, LLM'e özgü retry mantığı henüz yok.
- **Swift/iOS istemcisi (`HTTPBackedPlanner`).** Bu round yalnızca
  backend'i kurdu; iOS tarafında hâlâ `MockPlanner` kullanılıyor.
  Phase 4C'nin konusu.
- **CORS, kimlik doğrulama, rate limiting** — yerel/dev kullanım için
  gerekli değil; gerçek bir dağıtım öncesi ayrıca ele alınmalı.

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
