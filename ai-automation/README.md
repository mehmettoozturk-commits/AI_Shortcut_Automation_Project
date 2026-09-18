# AI Core — Automation DSL, Capability Registry, Validation Pipeline

Bu paket, `MASTER_SPEC.md` §7 (AI Conversation Engine) ve §15 (AI Güvenlik
Katmanı)'nde tarif edilen, platformdan bağımsız çekirdeği içerir. Hiçbir
iOS/Android kodu içermez; iOS App Intents/Shortcuts adaptörü ayrı bir
sonraki adımdır (§9, §31).

## İçerik

```
src/
├── domain/types.ts            → User, Automation, Device, Execution (§13)
├── dsl/schema.ts               → Automation DSL (workflow JSON şeması, §7)
├── capability-registry/
│   ├── types.ts                → Capability modeli (§8)
│   └── registry.ts             → Doğrulanmış capability listesi
└── validators/
    ├── schema-validator.ts     → Aşama 1: şekil doğrulama
    ├── capability-validator.ts → Aşama 2: registry'de var mı?
    ├── permission-validator.ts → Aşama 3: izin verilmiş mi?
    ├── safety-validator.ts     → Aşama 4: riskli aksiyon onaysız mı?
    └── pipeline.ts              → Hepsini zincirleyen runValidationPipeline()
```

## Neden bu sırayla ve neden şimdi bu kısım?

CLAUDE.md: *"AI çıktısını doğrudan çalıştırma; schema + capability +
permission validation kullan."* Bu dört katman, projenin güvenlik
omurgasıdır ve iOS/Android'e bağımlı olmadığı için şimdi, gerçek platform
kısıtları netleşmeden de doğru şekilde inşa edilebilir.

## Capability Registry'deki doğrulanmış gerçekler

- **`ios.bluetooth.disconnected`** — native destekleniyor. Kaynak: Apple
  Shortcuts resmi dokümantasyonu (Bluetooth setting trigger, "Is
  Disconnected" seçeneği).
- **`tesla.camera_action`** — **native desteklenmiyor.** Tesla'nın resmi
  Shortcuts entegrasyonu iklim, kilit, bagaj, şarj, sentry mode aç/kapat
  gibi komutları kapsıyor ama canlı kamera görüntüleme yok. Bu yüzden
  registry'de `nativeSupport: false` ve bir `fallbackMethod` (guided setup)
  ile işaretli — MASTER_SPEC §23'ün öngördüğü tam senaryo.

Bu iki gerçek, `tests/pipeline.integration.test.ts` içindeki uçtan uca
testte doğrudan doğrulanıyor: happy-path testi, kamera aksiyonu için bir
`requires_guided_setup` uyarısının kullanıcıya gösterilmesi gerektiğini
assert ediyor — "sessizce native gibi davranma" kuralının kod karşılığı.

## Güvenlik doğrulama mantığı (safety-validator.ts)

Riskli (`riskLevel: medium|high`) bir aksiyon adımı, plan içinde ondan önce
bir `ask_confirmation` adımı geçmemişse **hata** olarak reddedilir — sırası
da önemlidir (onay adımı riskli aksiyondan sonra gelirse yine reddedilir).
Registry'de olmayan/bilinmeyen bir capability varsayılan olarak riskli kabul
edilir (güvenli varsayım).

## Çalıştırma

```bash
npm install
npm run build   # tsc, tip kontrolü
npm test        # vitest — 25 test (unit + integration + negative)
```

Şu an: **158/158 test geçiyor.** (CLAUDE.md: "Testler başarısızsa
'tamamlandı' deme" — bu yüzden bu sayıyı burada açıkça belirtiyorum, testi
çalıştırmadan iddia etmiyorum.)

## Kapsam dışı (bilerek yapılmadı)

- iOS native adaptör (App Intents/Shortcuts bridge) — §31'e göre bu, AI
  Core doğrulandıktan sonraki adım.
- Compiler katmanı (plan → gerçek Shortcuts kurulumu) — Safety Validator'dan
  sonra gelir, henüz yazılmadı.
- Intent/Entity extraction (NLU) — kullanıcının doğal dil cümlesinden bu
  DSL'i üretecek AI prompt/parametreleri henüz yok; bu pipeline, DSL zaten
  üretilmiş kabul edip onu doğruluyor.
- Backend/DB, Android — §21 P1/P2 kapsamında, henüz sırası gelmedi.

## Sırada ne var?

Bir sonraki mantıklı adım muhtemelen **Intent/Entity extraction**: kullanıcı
cümlesini ("Arabadan indiğimde Tesla kamerasını açmak isteyip istemediğimi
sor") bu DSL'e çeviren katman — ya da doğrudan **Phase 1 UX prototype**
(Ekran 2-4: AI Builder, Eksik Bilgi, Onay). Hangisini istersen oradan devam
edebiliriz.


---

## Faz durumu

| Faz | Durum | Kapsam |
|---|---|---|
| Phase 0 — Feasibility | ✅ | Apple/Tesla capability doğrulaması (docs/capabilities.md) |
| Phase 1 — UX Prototype | ✅ | Builder state machine, ekranlar, mock port'lar (docs/ux.md) |
| Phase 1.5 — Capability Matrix + Compiler Contract | ✅ | Sürüm-duyarlı matris, resolver, kurulum modeli |
| Phase 2 — Intent + Entity Extraction | ✅ | Türkçe NLU boru hattı (docs/intent-entity.md) |
| Phase 3A — iOS Bridge Preparation | ✅ | Swift domain/DSL/registry/state machine portu, mock adaptörler (docs/ios-bridge.md) |
| Phase 3B — Real iPhone Validation | 📋 Plan hazır | 8 sistematik test, P0/P1 (docs/phase3b-validation-plan.md) — henüz çalıştırılmadı |

**TS test durumu: 177/177** (Phase 1: 101, Phase 2: +57, mimari kilit testleri: +19)
typecheck: PASS · build: PASS · web build: PASS

**Swift (ios-bridge/):** yazıldı, elle gözden geçirildi (parantez
dengesi dahil), **bu ortamda derlenmedi/test edilmedi** — Xcode/Swift
toolchain burada yok. Phase 3B'nin ilk işi `swift build && swift test`.
Ayrıntı: docs/ios-bridge.md.

### Phase 2 kapsamı

`src/nlu/` — Türkçe cümleden `DraftAutomationPlan` üretir.
Kural tabanlı deterministik sağlayıcı (LLM DEĞİL; sınırlar
docs/intent-entity.md §9'da). Provider arayüzleri sayesinde bir LLM
sağlayıcısı boru hattını değiştirmeden takılabilir.

Mimarî değişmez: capability kararı registry'ye, çalıştırılabilirlik
kararı validator zincirine aittir. NLU katmanında hiçbir capability id
hardcode edilmez — bu bir testle korunur.


### Bu turda kilitlenen iki mimari karar

1. **NLU → Swift bağlantısı:** iPhone uygulaması AI/NLU mantığını hiç
   içermeyecek; Swift `Planner` protokolü (zaten yazılı) TS backend'e
   HTTPS/JSON ile bağlanacak (`HTTPBackedPlanner`, Phase 3B). Ayrıntı:
   docs/ios-bridge.md §10.
2. **AI platforma özel id üretmez:** yalnızca semantik isimler
   (`vehicle_departure`, `vehicle_sentry_mode`) üretir; capability id
   çözümü backend registry'nin işi. Bu artık `tests/nlu-semantic-only.
   test.ts` ile çalışma zamanında kilitli (19 test).

### "Tek dokunuş" iddiası geri çekildi

`shortcuts://import-shortcut` ve Personal Automation'a programatik
tetikleyici bağlama, ikisi de **doğrulanmamış candidate mechanism**
olarak işaretlendi (docs/ios-bridge.md §5). Gerçek cihaz testi
(docs/phase3b-validation-plan.md Test 1-2) sonucuna göre MVP akışı ya
tek dokunuş kalır ya da üç adıma çıkar (**Kestirmeyi Hazırla →
Kestirmelere Ekle → Otomasyon Tetikleyicisini Bağla**). Netleşmeden
hiçbir ekran kopyası "tek dokunuşla kurulur" demiyor.
