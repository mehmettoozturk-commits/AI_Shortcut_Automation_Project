# Intent + Entity Extraction (Phase 2)

Bu doküman, doğal Türkçe cümleleri doğrulanmış bir
`DraftAutomationPlan`'e çeviren katmanı açıklar.

**Boru hattı — kestirme yok:**

```
Türkçe cümle
   ↓  IntentExtractor
Niyet (semantik)
   ↓  EntityExtractor
Entity'ler (normalize)
   ↓  PlanBuilder  ← capability eşlemesi YALNIZCA registry'den
DraftAutomationPlan
   ↓  Schema Validator
   ↓  Capability Validator
   ↓  Permission Validator
   ↓  Safety Validator
   ↓  Kullanıcı onayı (Builder Flow)
   ↓  Kurulum (user_assisted_import)
```

---

## 1. Önce dürüstlük notu: bu bir LLM değil

Bu fazda yazılan sağlayıcı **kural tabanlı ve deterministiktir**; Türkçe
örüntülere dayanır. LLM değildir ve öyleymiş gibi sunulmamalıdır.

Neden böyle: testler harici bir API'ye bağımlı olamaz (§14) ve bu
ortamda üretim LLM kimlik bilgisi kullanılmıyor (§18). Asıl kazanç,
**mimarinin** doğru kurulmuş olması: `IntentExtractor`,
`EntityExtractor`, `ClarificationEngine`, `PlanRevisionEngine`
arayüzlerinin arkasına bir LLM sağlayıcısı konduğunda boru hattı,
capability eşlemesi, clarification kuralları ve UI **değişmez**.

Kural tabanlı sağlayıcının sınırları §9'da açıkça listelenmiştir.

---

## 2. Intent şeması

```ts
interface IntentResult {
  intent: IntentType;          // create_automation | modify_automation | ...
  confidence: number;          // 0..1
  trigger?: SemanticTrigger;   // { type: "time" | "vehicle_departure" | ... }
  steps: SemanticStep[];       // { type: "notify" | "vehicle_climate" | ... }
  entities: Entities;
  missing: MissingEntity[];    // { field, reason }
  sourceText: string;
}
```

**Kritik:** `trigger.type` ve `steps[].type` **semantik adlardır**,
capability id'si değildir. NLU katmanı `tesla.sentry_mode.toggle` gibi
bir id'yi hiç görmez. Bu, testle sabitlenmiştir: AI katmanı kaynak
dosyalarında registry'deki hiçbir capability id'si geçmemelidir
(`tests/nlu-contract.test.ts`).

Desteklenen niyetler: `create_automation`, `modify_automation`,
`explain_automation`, `disable_automation`, `enable_automation`,
`delete_automation`, `not_understood`.

## 3. Entity şeması

Her entity `Normalized<T>` olarak saklanır: normalize edilmiş `value`,
kullanıcının orijinal ifadesi `raw`, ve gerekiyorsa `ambiguous`.

Kategoriler: time, date, recurrence, location, device, vehicle, person,
application, message, batteryLevel, condition, wifiNetwork, duration,
subject.

```
"Her pazartesi sabah 8'de"  → recurrence: {weekly, [1]}, time: 08:00
"Eve gelince"               → location: {semantic: home}
"Annem WhatsApp'tan yazınca"→ person: annem, application: WhatsApp
"Pil %20'nin altına düşünce"→ batteryLevel: 20, condition: below
```

**Uydurma yasağı:** kullanıcının vermediği hiçbir değer doldurulmaz.
"İlacımı hatırlat" cümlesinde ilacın *adı* yoktur; `entities.message`
boş kalır ve `missing: [{ field: "ilaç_name", reason:
"required_for_reminder" }]` üretilir.

## 4. Türkçe normalizasyon

Sayı sözcükleri ek soyularak okunur: "dokuzda" → 9, "yirmiye" → 20.

Tekrar: "her akşam" → daily, "her pazartesi" → weekly[1], "hafta içi" →
weekday, "haftada üç gün" → times_per_week(3).

Tetikleyici varyasyonları registry'deki `nluKeywords` üzerinden
eşleşir — yani yeni bir ifade eklemek için AI kodu değil registry
düzenlenir: "arabadan inince", "arabadan çıktığımda", "araçtan
ayrıldığımda", "arabadan uzaklaşınca".

### AM/PM belirsizliği asla sessizce çözülmez

| Girdi | Sonuç |
|---|---|
| "akşam dokuzda" | 21:00 |
| "sabah 9'da" | 09:00 |
| "21:00" | 21:00 |
| **"9'da"** | **ambiguous → "Sabah 9 mu, akşam 9 mu?"** |

Belirsiz durumda plan kesinleşmez; `time_of_day` eksik bilgisi
oluşturulur ve tek soru sorulur.

## 5. Güven anlamı

| Bant | Aralık | Davranış |
|---|---|---|
| high | ≥ 0.80 | akış devam eder |
| medium | 0.50–0.79 | anlama ekranı gösterilir |
| low | < 0.50 | clarification |

**Güven tek başına çalıştırma kararı vermez.** Yüksek güven bile
validator zincirini, kullanıcı onayını veya kurulum doğrulamasını
atlatmaz. Güven yalnızca *ne sorulacağını* etkiler.

## 6. Clarification kuralları

Phase 1.5 öncelik sırası aynen kullanılır: **tetikleyici → cihaz/kişi →
eylem detayı → opsiyonel tercihler**, her seferinde **tek soru**.

Desteklenmeyen bir capability varsa gereksiz soru sorulmaz: "Arabadan
inince kamerayı aç" cümlesinde araç sorulmadan doğrudan `unsupported`
döner ve registry'den türeyen alternatifler sunulur.

## 7. Revizyon kuralları

`PlanRevisionEngine` mevcut planı **revize eder**, yeni otomasyon
üretmez. Yalnızca düzeltilen parça değişir:

```
"Kamera değil Sentry Mode."   → eylem değişir; araç ve tetikleyici korunur
"Hayır, klimayı aç."          → eylem değişir; araç korunur
"Hayır, 9 değil 10."          → saat değişir; akşam bağlamı korunur (21:00 → 22:00)
"Hayır, Model 3."             → araç değişir; eylem ve tetikleyici korunur
```

Düzeltme yalnızca **desteklenen** bir eyleme geçebilir; desteklenmeyen
bir capability'ye geri dönüş reddedilir.

## 8. Konuşma bağlamı

```ts
interface ConversationContext {
  originalInput: string;
  currentPlan: DraftAutomationPlan | null;
  conversationTurns: Array<{ role, text }>;
  lastQuestion: string | null;
  lastMissingField: string | null;
  selectedEntities: Entities;
  lastIntent?: IntentResult;
}
```

Bağlam clarification, düzeltme, alternatif seçimi ve takip soruları için
gereklidir. Entity'ler **birleştirilir, silinmez**: üç turluk bir
konuşmada 1. turun eylemi, 2. turun aracı ve 3. turun düzeltmesi bir
arada yaşar.

## 9. Bilinen sınırlar (kural tabanlı sağlayıcı)

1. Örüntü dışı ifadeler anlaşılmaz; `not_understood` döner (uydurma
   yapmaz, ama kapsama dardır).
2. Koşul/istisna yok: "…ama cuma günleri yapma" henüz desteklenmiyor.
   Semantik model bunu taşıyacak şekilde tasarlandı (`SemanticTrigger.
   details`), ama çıkarım yapılmıyor.
3. Çoklu eylem ("hem klimayı aç hem kapıyı kilitle") tek eyleme indirger.
4. Güven skoru sezgisel bir formüldür; kalibre edilmemiştir.
5. Tarih aritmetiği yok: "yarın" sembolik olarak saklanır, gerçek
   takvim hesabı Phase 3'e ait.
6. `explain/disable/enable/delete` niyetleri tanınır ama bu niyetleri
   *uygulayan* akışlar henüz yok (Builder Flow yalnızca oluşturma yapar).

## 10. Test stratejisi

- **Deterministik:** harici API/LLM yok; tüm testler saf fonksiyon ve
  sınıf çağrıları.
- **Sözleşme testleri** (`nlu-contract.test.ts`) mimariyi korur:
  - registry eşlemesi değişince NLU eski capability'yi üretemez
  - AI kaynak dosyalarında hiçbir capability id'si geçmez
  - çok turlu akışta önceki bilgiler silinmez
  - AM/PM belirsizken kesin saat üretilmez
  - NLU planı validator zincirini atlayamaz (onay adımı çıkarılırsa
    Safety Validator yakalar)
- **Senaryo testleri** (`nlu.test.ts`) §15'teki 12 senaryonun tamamı.
