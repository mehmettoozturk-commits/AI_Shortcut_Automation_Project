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

- **CORS, kimlik doğrulama, rate limiting** — yerel/dev kullanım için
  gerekli değil; gerçek bir dağıtım öncesi ayrıca ele alınmalı.

(Bu bölümde daha önce listelenen "gerçek LLM çağrısı" ve "LLM JSON
hatası → retry" maddeleri Phase 4B'de, "Swift/iOS istemcisi" Phase 4C'de
kapatıldı — bkz. §8, §9 ve `docs/ios-bridge.md` Phase 4C bölümü.)

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

## 9. Phase 4C eki — sözleşme değişiklikleri (2026-09-19)

Swift `HTTPBackedPlanner`'ı gerçek bir backend'e karşı ilk kez
çalıştırırken (bkz. `docs/ios-bridge.md` Phase 4C bölümü) ortaya çıkan
iki sözleşme değişikliği — ikisi de geriye dönük UYUMLU (mevcut alanlar
değişmedi, yalnızca eklendi/ayrıştırıldı):

- **`"unsupported"` yanıtına yeni bir `trigger: string | null` alanı
  eklendi** (`src/nlu/types.ts`, `src/api/contract.ts`,
  `src/nlu/plan-builder.ts`). Registry'yi HİÇ bilmeyen bir istemcinin
  (Swift `HTTPBackedPlanner`), backend'in TS `NluPlannerAdapter`'ının
  yaptığı ile aynı deseni ("desteklenmeyen eylemi sahte bir plana göm,
  istemcinin KENDİ registry'sine buldur") tekrar edebilmesi için
  tetikleyicinin çözülmüş capability id'sine ihtiyacı vardı — önceden
  bu bilgi backend içinde hesaplanıyor ama dışa hiç aktarılmıyordu.
- **`status: "plan"` + `validation.ok: false` artık HTTP 200 değil 422
  döner** (gövde AYNI kalır). Amaç: bir istemcinin "isteği anladım ama
  çalıştıramam" durumunu (izin eksik, riskli eylem onaysız) genel bir
  200 başarısından ayırt edebilmesi — 400 (istek hatası) ve 502
  (`provider_error`, Phase 4B) ile birlikte artık üç farklı HTTP durumu
  üç farklı anlam taşıyor. `"unsupported"`/`"needs_clarification"`/
  `"not_understood"` HÂLÂ 200 — bunlar "isteği anladım, cevap bu"
  durumları, validation zincirinin konusu değil.

Test kapsamı: `tests/api-server.test.ts`'e 422 (`izin verilmemişse...`
testi artık durum kodunu da doğruluyor) ve `trigger` alanı için
assertion'lar eklendi; `tests/api-contract.test.ts`'in "unsupported"
fixture'ı yeni alanı içerecek şekilde güncellendi.

## 10. Hızlı referans — `POST /plan` sözleşmesi (Phase 4D checkpoint)

Bu bölüm §0-§9'da anlatılanları TEK bir yerde özetler; ayrıntı/gerekçe
için ilgili bölüme bakın. Şekiller `src/api/contract.ts`'in Zod
karşılığıyla birebir.

### İstek

```jsonc
POST /plan
{
  "text": "Arabadan inince Tesla Model Y'nin Sentry Mode'unu aç",
  "conversation": null,          // ilk turda yok; sonraki turlarda bir
                                  // önceki yanıtın `conversation` alanı
                                  // AYNEN geri gönderilir (§2)
  "platform": "ios",             // varsayılan "ios"
  "grantedPermissions": ["bluetooth", "tesla_account"]
}
```

### Yanıt — dört "başarı" durumu (hepsi HTTP 200 veya 422, ASLA 5xx)

| `status` | Ne zaman | Taşıdığı ek alanlar |
|---|---|---|
| `"plan"` | Semantik plan TAM ve registry'ye çözüldü | `plan` (capability id'leri İÇEREN, doğrulanmış taslak), `validation` (§4) |
| `"needs_clarification"` | Eksik TEK bir bilgi var (§3, docs/ux.md §7.4) | `question` (id/soru metni/seçenekler) |
| `"unsupported"` | Semantik geçerli ama registry'de karşılığı yok/kullanılamıyor | `capability`, `trigger` (Phase 4C, §9), `alternatives`, `reason` |
| `"not_understood"` | Sağlayıcı hiçbir semantiğe eşleyemedi | (ek alan yok) |

Dördünde de `intent` (LLM'in/kural tabanlı sağlayıcının SEMANTİK çıktısı
— capability id ASLA içermez, bkz. §10.2) ve `conversation` (bir sonraki
istekte aynen geri gönderilecek, opak taşınabilir durum) bulunur.

### HTTP durum kodu ↔ anlam (üç farklı "sorun", tek bir "başarı")

| HTTP | Ne zaman | Body |
|---|---|---|
| **200** | `plan` (validation.ok:true) / `needs_clarification` / `unsupported` / `not_understood` — "isteği anladım, cevap bu" | Yukarıdaki tablo |
| **400** | İstek gövdesi/şeması geçersiz (istemci hatası) | `{error, issues?}` |
| **422** | Semantik olarak TAM bir plan ama Schema/Capability/Permission/Safety zincirinden geçemedi (§4, §9) | `status:"plan"` gövdesi AYNEN, yalnızca `validation.ok:false` |
| **502** | LLM sağlayıcısı hiç çalışamadı — ağ hatası/geçersiz JSON (`provider_error`, §10.1) | `{status:"provider_error", message, conversation}` |

### 10.1 `provider_error` — `not_understood` ile KARIŞTIRILMAZ

`not_understood`, sağlayıcının (kural tabanlı veya LLM) BAŞARIYLA
çalışıp "bu niyeti tanımadım" dediği geçerli bir sonuçtur.
`provider_error` sağlayıcının HİÇ çalışamadığını gösterir (ağ hatası,
sağlayıcının geçersiz/şemaya uymayan JSON üretmesi) — bkz. §8.5.

### 10.2 Semantic output → registry resolution (değişmez, tekrar)

```
Kullanıcı cümlesi → NluProvider (kural tabanlı veya LLM) → SEMANTİK
IntentResult (yalnızca "vehicle_departure"/"vehicle_sentry_mode" gibi
isimler, NOKTA İÇERMEZ) → plan-builder.ts + Capability Registry →
capability id'ler ("ios.bluetooth.disconnected"/"tesla.sentry_mode.
toggle") → DraftAutomationPlan
```

Capability id'leri **LLM'e prompt/context olarak dahi verilmez** —
yalnızca `buildSemanticCatalog()`'un ürettiği `{semantic, kind,
description}` üçlüsü görülür (§8.2). Bu, hem statik kaynak taramasıyla
(`tests/nlu-contract.test.ts`) hem çalışma zamanı testleriyle
(`tests/llm-provider.test.ts`, `tests/nlu-semantic-only.test.ts`) hem de
gerçek bir SwiftUI ekranında (Phase 4D-1, `HTTPBackedPlannerTests`/
`AutomationAppUITests`) kilitli.

## 11. Temporal ambiguity — Türkçe saat belirsizliği (Phase 4D-3)

Bir `time` tetikleyicisi için saat ifadesi 12 saatlik formatta VE bir
gün bölümü (sabah/öğle/öğleden sonra/akşam/gece) VEYA 24 saatlik format
içermiyorsa, sistem SESSİZCE bir saat seçmez — clarification ister.
Bu, iki katmanla korunur:

1. **Prompt** (`systemPrompt()`, `src/nlu/providers/llm-schema.ts`) —
   LLM'e açık "SAAT KURALI" talimatı: böyle bir durumda `missing`e
   `{field: "time_of_day", reason: "am_pm_ambiguous"}` eklemesi
   söylenir. Bu bir talimattır, GARANTİ değil.
2. **Deterministik güvenlik ağı** (`hardenTemporalAmbiguity`,
   `NluPipeline.planAsync()` içinde uygulanır — tek bir paylaşılan
   yardımcıya değil, HANGİ `NluProvider` olursa olsun çıktısını
   yakalayan pipeline seviyesine gömülü) — gerçek bir NVIDIA NIM smoke
   testinde bir modelin "9'da bana hatırlat." için ne clarification
   sorduğu ne bir saat uydurduğu, şema açısından geçerli ama saat
   bilgisi TAMAMEN EKSİK bir plan ürettiği gözlemlendi. Bu katman,
   `sourceText`'i modele GÜVENMEDEN kural tabanlı `normalizeTime()` ile
   YENİDEN değerlendirir.

### Örnekler (gerçek davranış, `tests/nlu.test.ts` + `tests/temporal-hardening.test.ts`'te kilitli)

| Girdi | Sonuç |
|---|---|
| `"9'da bana hatırlat."` | `needs_clarification` ("Sabah 9 mu, akşam 9 mu?") — gün bölümü yok |
| `"akşam 9'da bana hatırlat."` | `21:00` — "akşam" gün bölümünü belirtiyor |
| `"sabah 9'da bana hatırlat."` | `09:00` |
| `"21'de bana hatırlat."` | `21:00` — 24 saatlik format zaten kesin |
| `"öğlen 12'de bana hatırlat."` | `12:00` |
| `"gece 12'de bana hatırlat."` | `00:00` — gece yarısı |

Son ikisi (`öğlen`/`gece` + saat 12) Phase 4D-3'te düzeltilen GERÇEK bir
öncesi hatayı temsil ediyor: `normalizeTime()` "gece"yi "akşam" ile aynı
kovaya koyuyordu, bu da "gece 12'de" için 00:00 yerine 12:00 üretiyordu
(bkz. `src/nlu/turkish.ts`).

## 12. Semantic completeness — malformed-semantic validation (Phase 4E-1)

Üç katmanlı koruma zinciri artık şöyle:

```
LLM → Schema (Zod, LlmPlanOutputSchema) → Semantic completeness
    → Registry (plan-builder.ts)
```

`checkSemanticCompleteness()` (`src/nlu/providers/llm-schema.ts`,
`NluPipeline.planAsync()` içinde §11'deki `hardenTemporalAmbiguity` ile
AYNI yerde uygulanır), Zod şemasını geçen ama ANLAMSAL olarak bozuk bir
çıktıyı yakalar — bunlar SESSİZCE `"unsupported"`a düşürülmez (o,
registry'nin "anladım ama yapamam" kararı için ayrılmış), `provider_error`
olarak raporlanır: LLM burada kendi sözleşmesini ihlal etmiştir, bu bir
business-logic sonucu değildir.

Gerçek bir NVIDIA NIM smoke testinde gözlemlenen iki somut ihlal:

1. **Katalog satırı öneki sızıntısı.** Sistem promptu semantikleri
   `- [trigger] vehicle_departure: ...` biçiminde listeliyor; model bazen
   `"[trigger] "`/`"[action] "` önekini SEMANTİK ALANA kopyalıyor
   (`trigger.semantic: "[trigger] vehicle_departure"`). Böyle bir
   semantik registry'de yok — düzeltmek yerine (sessiz post-processing
   RİSKLİ: hangi önek biçimlerinin "güvenle" temizlenebileceğine dair
   kapsamlı olmayan bir varsayım listesi gerekir) doğrudan reddedilir.
2. **Eylemin tamamen kaybolması.** `intent: "create_automation"` +
   geçerli bir `trigger` + `steps: []`. Registry'nin kendi "unsupported"
   mesajı ("karşılık gelen bir işlem bulamadım") burada YANLIŞ bir
   çerçeve olurdu — registry hiçbir şeyi ÇÖZMEYE bile çalışmadı, model
   eylemi hiç üretmedi.

`"unmapped:"` öneki (rule-based sağlayıcının, registry'de karşılığı
olmayan ama GERÇEKTEN anlaşılan bir eylemi işaretlemek için kullandığı
kasıtlı konvansiyon) istisnadır — reddedilmez, registry'nin kendi
`unsupported` akışına düşmeye devam eder.

Gerçek NVIDIA sunucusuna karşı doğrulandı: aynı "9'da bana hatırlat."
girdisi art arda denendiğinde, önek sızıntısı ve eksik eylem
durumlarının İKİSİ de artık `provider_error` olarak net bir mesajla
raporlanıyor; hiçbiri sessizce `unsupported`a düşmüyor.

Test kapsamı: `tests/semantic-completeness.test.ts` (12 test) —
`checkSemanticCompleteness()`'ın birim testleri artı `NluPipeline.
planAsync()` üzerinden uçtan uca doğrulama (önek sızıntısı, boş eylem,
geçerli plan yanlış pozitif üretmiyor, gerçek `unsupported` hâlâ
`unsupported` kalıyor).
