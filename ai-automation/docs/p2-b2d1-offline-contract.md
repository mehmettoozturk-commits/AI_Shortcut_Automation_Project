# B2D-1 — Offline provider contract validation

Başlangıç HEAD `3f9b57514b9fe6db152a1959e1507c73fd03fd5c`.
Yalnız sentetik sözleşme/fixture/statik denetim. Gerçek Groq SDK response'u,
gerçek kalite, token/fatura doğruluğu veya pilot aktivasyonu kanıtlanmaz.

## Dört yeni dosya

- `src/evaluation/b2d1-contract.ts`: selected-field fixture doğrulama,
  offline prompt rezervasyon aritmetiği ve muhafazakâr schema profile checker.
- `src/evaluation/b2d1-fixtures.ts`: elle yazılmış örnek response ve prompt sayıları.
- `tests/b2d1-contract.test.ts`: pozitif/negatif contract ve schema karakterizasyonu.
- `docs/p2-b2d1-offline-contract.md`: bu sözleşme ve riskler.

LP1/LP2/B2C, production adapter/API/auth/router/Local-First ve dependency değişikliği
yoktur. Gerçek SDK/HTTP istemcisi veya env/key/billing erişimi eklenmez. Validator
transport kabul etmez; bütün başarılı sonuçlarda `realDispatchAllowed=false` sabittir.

## Kaynak ve kanıt düzeyi — 16 Ekim 2026

[Groq API referansı](https://console.groq.com/docs/api-reference), completion limiti
için `max_completion_tokens` alanını ve eski `max_tokens` alanının deprecated
olduğunu belgeliyor. [Reasoning belgesi](https://console.groq.com/docs/reasoning)
reasoning metninin response'ta gösterilmesini ayrı ayarla kontrol ediyor; metni
gizlemekten sıfır reasoning maliyeti sonucu çıkarılmaz.

[Resmi SDK kullanım tipi](https://github.com/groq/groq-typescript/blob/main/src/resources/completions.ts)
prompt, completion, total ve completion breakdown içinde reasoning alanını
tanımlıyor. Alanın tipte bulunması her gerçek yanıtta geleceği anlamına gelmez.
[Structured Outputs belgesi](https://console.groq.com/docs/structured-outputs)
strict model desteği, kapalı nesneler ve nullable required alan örnekleri veriyor.
Bu kaynaklar canlı çağrı testi veya bizim şemamızın kabulünün kanıtı değildir.
Fiyat, ücretsiz kota veya ticari şartlar bu fazda yeniden onaylanmadı.

## Response projection sözleşmesi

`fixtureVersion=groq-chat-synthetic-v1` bir benchmark wrapper'ıdır, Groq wire alanı
değildir. Sadece seçilmiş response alanları kullanılabilir. Gerçek SDK response'unu
bu projeksiyona çeviren kod yoktur. Extra alanlar strict şemada reddedilir; bu,
gerçek API'nin başka alan dönmediği iddiası değil, yeni mapping gerekliliğidir.

Yalnız açık 20B/120B aday model ID'si ve caller'ın beklediği model/config eşleşmesi
kabul edilir. Tek choice, assistant string content, null refusal ve tam `stop`
finish reason gerekir. `length`, tool-call, unknown veya başka terminal değer
başarı sayılmaz. Boş/64 KiB üstü UTF-8 content reddedilir; iç JSON'un semantik
doğruluğu burada ölçülmez. Bunun için ayrı B2C/LP1 katmanı vardır.

Usage: safe integer nonnegative prompt/completion/total; reasoning breakdown
zorunludur, eksik değer 0'a çevrilmez. Bu sentetik profilde reasoning completion
alt kümesidir; reasoning<=completion ve total=prompt+completion gerekir. Çelişki,
eksiklik veya taşma fail-closed olur. Reasoning yeniden eklenmez. Bu policy gerçek
model/fatura için doğrulanmış değildir; bilinmeyen gerçek semantik STOP'tur.

## Prompt/token preflight

System, schema, user, history, repair ve chat-template overhead ayrı ve zorunlu
sayılardır; boş bileşen için açık 0 gerekir. İlk çağrı repair=0 olmalıdır. Bir
veya en fazla iki çağrı için ayrı input ve max output rezervasyonu hesaplanır;
call/token/micro-USD sınırları birlikte uygulanır. Model/tokenizer revision aynı
olmalı. `estimate` veya bilinmeyen değer offline uygunluk da vermez.

`synthetic-exact` sadece mock test kanıtıdır. Herhangi bir caller bu etiketi
yazabilir; bu kriptografik attestation değildir. Bu nedenle offlineEligible=true
olsa bile gerçek dispatch her zaman yasaktır. Bu fonksiyon gerçek tokenizer
çalıştırmaz, chat-template overhead'i bulmaz ve gerçek üst sınır kanıtlamaz.
Üretim promptu/system/schema/history/repair bileşenlerinin gerçek tokenizer ve
revision ile doğrulanması, sağlayıcı completion/billing sözleşmesi ve harcama
koruması hâlâ pilot blocker'ıdır.

## Statik schema bulguları

Checker bir JSON Schema validator'ı veya Groq'un tam destek listesi değildir.
Belgedeki örneklerden yararlanılarak yerel seçilmiş muhafazakâr allowlist kullanır: kapalı
object, bütün properties required, primitive/nullable type, array/items, enum,
anyOf ve çözülen yerel $defs/$ref. Bilinmeyen keyword FAIL (`unverified_keyword`)
olur; bu keyword'ün Groq tarafından kesin reddedildiği iddia edilmez.
Şema değiştirme, alanları silme veya best-effort fallback yoktur.

Mevcut `LlmPlanOutputJsonSchema` değişmeden incelendi: **11 bulgu**:
üç `properties_not_all_required`, iki `propertyNames`, iki açık details object,
iki properties eksikliği ve confidence minimum/maximum için iki unverified keyword.
Sonuç `staticProfilePassed=false`, `providerAcceptanceVerified=false`.
Bu, mevcut json_object production akışında yeni bir regresyon bulunduğu anlamına
gelmez; strict pilot şema profilinin ayrı tasarlanması gerektiğini gösterir.
DSL kaynak şeması v3 Zod/lazy olduğundan doğrudan Groq'a gönderilecek wire şema
değildir. Bu faz mevcut LLM wire JSON schema'yı karşılaştırır; DSL'i veya adapter'ı
yeniden yazmaz. Gereksinimleri silerek sahte strict uyum üretilmez.

## Doğrulama ve açık riskler

`npm run build` PASS; hedefli 47/47 test PASS. Son kaynaklarla `npm test`
1010/1010 PASS, 45 dosya (önceki 963 + 47). Önceden mevcut untracked auth-server
dosyasının 5 testi toplamda yer alır, dosya değiştirilmedi. Mevcut localhost mock
testleri yerel port izniyle çalıştı; gerçek sağlayıcı bağlantısı yoktu.
Gerçek provider invocation 0; API key/env/billing erişimi 0. Test verileri yalnız
elle yazılmış sentetik örneklerdir, gerçek hesap çıktısı veya kullanıcı metni yoktur.
Bağımsız doküman okuyucu gerçek dispatch yasağını, sentetik kanıt sınırlarını,
schema FAIL'in Groq reddi olmadığını ve pilot blocker'larını doğru okudu.

Açık kalanlar: gerçek SDK projection/mapping, usage/billing ve token üst sınırı,
strict şema kararı, global ledger/rollback witness, operator recovery, holdout
bağımsız okuması, RH-02/RH-07 ve P3/P4. Bu aşama bunları uygulamaz veya kapatmaz.
Gerçek pilot ayrıca açık insan işlem ve maliyet yetkisi gerektirir.
