# AI Shortcut Automation Platform — Master Specification

## 1. Ürün Özeti

Bu proje, teknik bilgi gerektirmeden kullanıcıların doğal dil veya ses komutuyla telefon otomasyonları/kestirmeleri oluşturmasını sağlayan AI destekli bir mobil uygulamadır.

Temel vaat:

> Kullanıcı ne yapmak istediğini söyler → AI ihtiyacı anlar → eksik bilgileri sorar → otomasyonu görsel olarak açıklar → kullanıcı onaylar → mümkün olan en native otomasyon/kestirme oluşturulur → kullanıcı bunu işletim sisteminin otomasyon altyapısıyla kullanır.

İlk hedef platform: iPhone / iOS.
İkinci hedef platform: Android.

Önemli prensip: Uygulama işletim sistemlerinin izin ve sandbox sınırlarını aşmaya çalışmaz. Desteklenmeyen bir işlemi "yapıldı" gibi göstermemeli; bunun yerine kullanıcıya açıkça manuel bir son adım göstermelidir.

---

## 2. İlk MVP Senaryosu

### Senaryo: Araçtan ayrılınca Tesla kamera otomasyonu

Kullanıcı:

> "Arabadan indiğimde bana Tesla'nın canlı kamerasını açmak isteyip istemediğimi sor."

AI bunu şu mantıksal yapıya dönüştürür:

- Tetikleyici: Kullanıcının araç/Bluetooth bağlantısından ayrılması
- Bağlam: Tanımlı araç
- Eylem: Kullanıcıya onay sor
- Onay = Evet: desteklenen Tesla/Shortcuts eylemini çalıştır
- Onay = Hayır: hiçbir işlem yapma

### Kritik teknik gerçek

iOS'ta üçüncü taraf bir uygulamanın her türlü Shortcut'ı sınırsız biçimde programatik olarak oluşturması/kurması garanti edilemez. Apple'ın Shortcuts, App Intents, URL scheme'leri, otomasyon tetikleyicileri ve kullanıcı izinleri sınırları ayrıca doğrulanmalıdır.

Bu nedenle mimari iki seviyeli olmalıdır:

1. **Native otomasyon:** Apple'ın desteklediği API/App Intents/Shortcuts mekanizmalarıyla mümkün olan akış.
2. **Guided setup:** Native olarak otomatik kurulamayan kısım varsa kullanıcıyı Shortcuts içinde adım adım yönlendiren akış.

Tesla tarafında da kullanılabilecek resmi/desteklenen entegrasyonlar ve üçüncü taraf entegrasyonlar ayrı değerlendirilmelidir. Güvenlik açısından kullanıcı Tesla hesabı kimlik bilgilerini uygulamaya vermemelidir; mümkünse OAuth/deep link/resmi entegrasyon kullanılmalıdır.

---

## 3. Ürün Felsefesi

Kullanıcıya "trigger", "condition", "action", "variable", "API" gibi teknik kavramları göstermemek.

Kullanıcı dili:

- "Ne yapmak istiyorsun?"
- "Ne zaman olsun?"
- "Bunu hangi araçta/telefonda kullanacaksın?"
- "Şu eksik bilgiyi tamamlayalım."
- "Bunu böyle anladım. Doğru mu?"
- "Hazır. Oluşturalım mı?"

İleri seviye kullanıcılar için "Detaylar" ekranı olabilir.

---

## 4. UX Araştırması ve Referans Ürünler

Araştırma yapılırken özellikle şu ürünlerin UX kalıpları incelenmelidir:

- Apple Shortcuts
- IFTTT
- Zapier
- Make
- Tasker
- Samsung Modes and Routines
- Google Home otomasyonları
- Home Assistant
- Siri / Apple Intelligence tarzı doğal dil etkileşimleri

### Rakiplerden alınabilecek iyi kalıplar

**Apple Shortcuts**
- Native sistem entegrasyonu
- Güçlü otomasyon seçenekleri
- Ancak teknik kullanıcıya daha yakın arayüz

**IFTTT**
- Basit "If This Then That" zihinsel modeli
- Hazır şablonlar

**Zapier / Make**
- Çok güçlü workflow modeli
- Ancak son kullanıcı için karmaşık olabilir

**Tasker**
- Android'de çok güçlü koşul/eylem sistemi
- Öğrenme eğrisi yüksek

**Samsung Modes and Routines**
- Günlük kullanım senaryolarını kolaylaştıran hazır yapı
- Cihaz bağlamı güçlü

Bizim farklılaşmamız:

> Teknik workflow editörü değil, doğal dilden otomasyon üreten bir "AI Automation Copilot".

---

## 5. Ana Navigasyon

Alt tab:

1. **Ana Sayfa**
2. **Otomasyonlar**
3. **Şablonlar**
4. **Aktivite**
5. **Ayarlar**

Floating/primary CTA:

**+ Yeni Otomasyon**

---

## 6. Ekran Tasarımları

### Ekran 1 — Ana Sayfa

Üst:
"Bugün neyi otomatikleştirelim?"

Büyük input:
"Bir şey yaz veya söyle..."

Mikrofon butonu:
"Konuş"

Hazır öneriler:

- 🚗 Arabadan inince
- 💬 Mesaj gelince
- 💊 İlaç zamanı
- 🔋 Pil azalınca
- 📍 Eve gelince
- 🗓️ Toplantıdan 10 dk önce
- 🎧 Bluetooth bağlanınca
- 🌙 Gece olunca

Alt bölüm:
"Son otomasyonların"

Kartlar:
- Tesla — Arabadan ayrılınca
- İlaç — 21:00 hatırlat
- Ev — Eve gelince ışıkları aç

---

### Ekran 2 — AI Builder

Kullanıcı metin veya ses verir.

Örnek:

> "Arabadan indiğimde Tesla kamerayı açmak isteyip istemediğimi sor."

AI önce niyeti çıkarır.

UI:

**Seni şöyle anladım**

🚗 Arabadan ayrılınca  
↓  
❓ Kamerayı açmak isteyip istemediğini sor  
↓  
✅ Evet → Tesla kamera işlemi  
❌ Hayır → Hiçbir şey yapma

Butonlar:

- "Doğru"
- "Bir şey değiştir"

---

### Ekran 3 — Eksik Bilgi

AI sadece gerçekten gerekli bilgiyi sorar.

Örneğin:

> "Hangi araç?"

Seçenek:

- Tesla Model Y
- Tesla Model 3
- Başka araç

Birden fazla soru gerekiyorsa mümkün olduğunca tek tek sor.

---

### Ekran 4 — Onay

Başlık:

**Otomasyonun hazır 🎉**

Kart:

**Arabadan ayrıldığında**

1. Araç bağlantısı kesilecek
2. Sana "Tesla kamerasını açmak ister misin?" sorulacak
3. Evet dersen işlem çalışacak
4. Hayır dersen hiçbir şey olmayacak

Buton:
**Oluştur**

İkincil:
**Düzenle**

---

### Ekran 5 — Kurulum

Progress:

1. Anlaşıldı ✓
2. Hazırlanıyor ✓
3. Telefon bağlantısı kuruluyor
4. Tamamlanıyor

Native otomasyon mümkünse otomatik kurulum.

Değilse:

**Son bir adım var**

"Shortcuts'ta şu işlemi tamamla"

Adım adım görsel rehber.

---

### Ekran 6 — Otomasyon Detayı

Başlık:
"Tesla — Arabadan ayrılınca"

Toggle:
Aktif / Pasif

Tetik:
Araç bağlantısı kesildi

Eylem:
Kullanıcıya soru sor

Onay:
Tesla kamera işlemi

Alt:
"Son çalıştırmalar"

---

### Ekran 7 — Şablonlar

Kategoriler:

🚗 Araba
💬 Mesajlaşma
💊 Sağlık/hatırlatıcı
🏠 Ev
📍 Konum
🔋 Telefon
📅 Takvim
🎧 Medya
✈️ Seyahat
🌙 Uyku
☀️ Sabah
💼 İş

Şablon örnekleri:

- Arabadan inince bana sor
- Eve gelince Wi-Fi kontrol et
- Pil %20 altına düşünce uyar
- Toplantıdan 10 dakika önce sessize al
- Her akşam ilaç hatırlat
- Bluetooth bağlanınca müzik aç

Not: İlaç/sağlık senaryolarında uygulama tıbbi karar vermez; yalnızca kullanıcı tanımlı hatırlatma/otomasyon sağlar.

---

## 7. AI Conversation Engine

AI pipeline:

User Input
→ Speech-to-Text (ses ise)
→ Intent Extraction
→ Entity Extraction
→ Capability Check
→ Missing Information Detection
→ Clarification
→ Automation Plan
→ User Confirmation
→ Native Automation Compiler
→ Validation
→ Installation/Guided Setup
→ Execution Monitoring

### Örnek JSON planı

```json
{
  "name": "Tesla kamerayı sor",
  "trigger": {
    "type": "bluetooth_disconnected",
    "device": "Tesla"
  },
  "steps": [
    {
      "type": "ask_confirmation",
      "message": "Tesla canlı kamerayı açmak ister misin?"
    },
    {
      "type": "conditional",
      "condition": "answer == yes",
      "then": [
        {
          "type": "tesla_camera_action"
        }
      ],
      "else": []
    }
  ]
}
```

Bu JSON doğrudan çalıştırılabilir kod olarak kabul edilmemelidir. Önce capability validator tarafından kontrol edilmelidir.

---

## 8. Capability Registry

Her platform için desteklenen yetenekler merkezi bir registry'de tutulmalı.

Örnek:

```text
Capability
- id
- platform
- trigger
- action
- permission
- nativeSupport
- setupMethod
- fallbackMethod
- riskLevel
```

Örnek:

```json
{
  "id": "ios.bluetooth.disconnected",
  "platform": "ios",
  "nativeSupport": true,
  "setupMethod": "shortcuts_automation"
}
```

Bir AI çıktısının güvenli olmasının ana koşullarından biri, yalnızca registry'de gerçekten desteklenen capability'leri üretmesidir.

---

## 9. iOS Mimari

Öneri:

- Swift
- SwiftUI
- App Intents
- Shortcuts integration
- Event/automation handoff
- Local notifications
- CoreBluetooth yalnızca izin verilen kullanım alanlarında
- Core Location yalnızca gerekli senaryolarda
- Keychain
- BackgroundTasks gereken yerlerde
- WidgetKit isteğe bağlı
- App Groups gerekirse

### iOS modülleri

```text
iOS/
├── App/
├── UI/
├── Features/
│   ├── Home/
│   ├── Builder/
│   ├── Automations/
│   ├── Templates/
│   ├── Activity/
│   └── Settings/
├── AI/
├── Automation/
├── Shortcuts/
├── AppIntents/
├── Permissions/
├── Integrations/
│   └── Tesla/
├── Storage/
└── Networking/
```

---

## 10. Android Mimari

Öneri:

- Kotlin
- Jetpack Compose
- Android App Actions / intents uygun olduğu yerde
- Bluetooth APIs
- Geofencing
- Notifications
- WorkManager
- Foreground services yalnızca gerekli ve izin verilen kullanım durumlarında
- Tasker integration opsiyonel
- Samsung Modes and Routines entegrasyonu yalnızca resmi olarak desteklenen yollarla

Android'de tek bir "Shortcuts" karşılığı olmadığı için capability abstraction şarttır.

---

## 11. Cross-Platform Mimari

UI için:

- Flutter veya React Native değerlendirilebilir.

Ancak native automation özellikleri yoğun olduğu için native modules zorunludur.

Önerilen yaklaşım:

```text
Shared
├── Domain
├── AI protocol
├── Automation DSL
├── Capability model
└── Backend API

iOS
└── Native Automation Adapter

Android
└── Native Automation Adapter
```

AI tarafından üretilen workflow platform bağımsız bir intermediate representation (IR) olmalıdır.

---

## 12. Backend

Öneri:

- TypeScript / Node.js veya Python
- PostgreSQL
- Redis
- Object storage gerektiğinde
- Authentication
- API gateway
- Observability

Backend sorumlulukları:

- kullanıcı hesabı
- automation metadata
- template katalogu
- AI orchestration
- capability definitions
- analytics
- crash/error telemetry
- remote configuration

Hassas credential'lar mümkün olduğunca backend'e gönderilmemelidir.

---

## 13. Veri Modeli

### User

```text
id
createdAt
platform
locale
timezone
```

### Automation

```text
id
userId
name
platform
status
trigger
workflow
version
createdAt
updatedAt
```

### Device

```text
id
userId
type
name
platformIdentifier
metadata
```

### Execution

```text
id
automationId
startedAt
finishedAt
status
errorCode
```

---

## 14. Güvenlik

Öncelikler:

- Minimum izin
- Keychain / Android Keystore
- OAuth tercih edilir
- Token'ları loglamama
- AI promptlarına gereksiz kişisel veri göndermeme
- Encryption in transit
- Encryption at rest
- Audit log
- Kullanıcı otomasyonu istediği zaman kapatabilmeli
- Her kritik işlemden önce açık onay

AI hiçbir zaman kullanıcı adına desteklenmeyen veya gizli bir cihaz işlemini "uydurmamalıdır."

---

## 15. AI Güvenlik Katmanı

Her AI workflow'u şu aşamalardan geçmeli:

```text
Intent Parser
↓
Schema Validator
↓
Capability Validator
↓
Permission Validator
↓
Safety Validator
↓
Human Confirmation
↓
Compiler
```

AI'nin doğrudan native kod çalıştırmasına izin verilmemeli.

---

## 16. Sesli Komut

Akış:

```text
Tap microphone
↓
Record
↓
Speech-to-text
↓
Transcript shown to user
↓
AI interprets
↓
Clarification if needed
```

Kullanıcı konuşurken metnin canlı gösterilmesi güven artırır.

---

## 17. "AI Yanlış Anladı" Tasarımı

Her otomasyon için kullanıcıya doğal dil özeti gösterilmeli.

Örneğin:

> "Arabadan ayrıldığında Tesla kamerasını açmak isteyip istemediğini sana soracağım."

Alt:

**Değiştir**

Kullanıcı:
> "Kamera yerine klimayı açmayı sor."

AI planı günceller.

---

## 18. Hata Yönetimi

Örnek:

**Tesla bağlantısı bulunamadı**

> "Tesla hesabınla bağlantı kurulamadı. Tekrar deneyelim."

Buton:
"Tekrar dene"

Desteklenmeyen işlem:

> "Bu işlem iPhone tarafından otomatik olarak kurulmaya izin verilmiyor."

Buton:
"Nasıl kuracağımı göster"

Asla:
"Tamamlandı" dememeli.

---

## 19. Tasarım Sistemi

Genel tasarım:

- temiz
- büyük dokunma alanları
- az metin
- kart tabanlı
- güçlü ikonografi
- açık hiyerarşi
- mümkün olduğunca tek ekran/tek karar
- dark mode
- Dynamic Type
- VoiceOver
- erişilebilir kontrast
- Türkçe dahil localization

Ana CTA her zaman görünür olmalı.

---

## 20. Onboarding

4 ekranı geçmemeli.

1. "Telefonundaki işleri senin için otomatikleştir."
2. "Yazarak veya konuşarak anlat."
3. "AI eksik bilgileri tamamlar."
4. "Onayla ve kullan."

İzinler ihtiyaç anında istenmeli; ilk açılışta bütün izinleri istememeli.

---

## 21. MVP Kapsamı

### P0

- iOS
- hesap
- doğal dil giriş
- ses girişi
- AI clarification
- workflow preview
- user confirmation
- automation list
- templates
- capability registry
- Shortcuts/App Intents entegrasyon araştırması
- bir adet uçtan uca otomasyon

### P1

- Android
- daha fazla trigger
- Tesla integration
- location
- battery
- Wi-Fi
- calendar
- notifications
- messaging

### P2

- smart home
- travel
- advanced conditions
- automation sharing
- community templates
- analytics
- multi-step workflows

---

## 22. Örnek Otomasyon Kataloğu

### Araba

- Bluetooth bağlanınca
- Bluetooth ayrılınca
- Eve yaklaşınca
- İşe yaklaşınca
- Araçtan ayrılınca soru sor

### Telefon

- Pil %20
- Pil %80
- Şarja bağlanınca
- Şarjdan çıkınca
- Belirli Wi-Fi'ye bağlanınca

### Mesajlaşma

- Belirli kişiden mesaj gelince bildirim
- Kullanıcı tarafından tanımlanan metin için taslak hazırla
- Mesaj geldiğinde kullanıcıya hatırlat

Not: WhatsApp gibi uygulamalarda gerçek otomatik mesaj gönderme yeteneği platform/API izinlerine bağlıdır.

### Takvim

- Toplantıdan 10 dakika önce
- İş günü başlangıcında
- Takvim etkinliği bitince

### Ev

- Eve gelince
- Evden çıkınca
- Gece
- Sabah

---

## 23. Tesla Entegrasyonu İçin Ayrı Araştırma Görevi

Kodlamadan önce doğrulanacak:

1. Tesla'nın güncel resmi API/SDK imkanları
2. Mobil uygulama deep link imkanları
3. Apple Shortcuts desteği
4. App Intents ile Tesla aksiyonlarının erişilebilirliği
5. Üçüncü taraf entegrasyonların güvenlik/ToS durumu
6. Kamera/Live Camera işleminin kullanıcı hesabında ve araç modelinde destek durumu
7. Kullanıcı onayı gerektiren noktalar

Bu doğrulama tamamlanmadan "Tesla kamerayı kesin otomatik açar" kabulü yapılmamalıdır.

---

## 24. Claude Code Proje Yapısı

```text
ai-automation/
├── README.md
├── MASTER_SPEC.md
├── CLAUDE.md
├── docs/
│   ├── architecture.md
│   ├── ux.md
│   ├── ios.md
│   ├── android.md
│   ├── security.md
│   ├── ai.md
│   ├── capabilities.md
│   └── testing.md
├── apps/
│   ├── ios/
│   └── android/
├── packages/
│   ├── domain/
│   ├── automation-dsl/
│   ├── capability-registry/
│   └── api-client/
├── backend/
│   ├── api/
│   ├── ai/
│   ├── database/
│   └── workers/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── contract/
│   └── e2e/
└── scripts/
```

---

## 25. CLAUDE.md İçin Geliştirme Kuralları

Claude Code:

1. Önce mevcut repository'yi analiz et.
2. Spec'i okumadan kod yazma.
3. Önce plan çıkar.
4. Kullanıcı onayı gerektiren ürün kararlarını kendin varsayma.
5. Platform capability'si doğrulanmadan entegrasyon yazma.
6. Her yeni capability için test yaz.
7. UI değişikliklerinde accessibility kontrol et.
8. AI çıktısını schema validation olmadan çalıştırma.
9. Secret/token commit etme.
10. Mevcut çalışan özellikleri bozma.
11. Her milestone sonunda testleri çalıştır.
12. Dokümantasyonu kodla birlikte güncelle.
13. Unsupported capability için fallback UX oluştur.
14. "Fake success" üretme.

---

## 26. Geliştirme Sırası

### Phase 0 — Discovery

- Apple Shortcuts/App Intents güncel dokümantasyonu
- Android automation imkanları
- Tesla resmi entegrasyonları
- Rakip UX araştırması
- teknik feasibility

### Phase 1 — UX Prototype

- Figma
- onboarding
- AI builder
- preview
- confirmation
- automation cards

### Phase 2 — AI Core

- speech-to-text
- intent extraction
- clarification
- workflow JSON
- validation

### Phase 3 — iOS MVP

- SwiftUI
- App Intents
- Shortcuts bridge
- notifications
- automation storage

### Phase 4 — First Real Automation

- Bluetooth disconnect
- confirmation
- supported action
- fallback guided setup

### Phase 5 — Template Engine

- template catalog
- category system
- one-tap customization

### Phase 6 — Android

- native automation adapter
- Android-specific capabilities

---

## 27. Test Stratejisi

### Unit

- intent parser
- workflow parser
- capability validator
- permission validator
- compiler

### Integration

- AI → workflow
- workflow → capability
- capability → native adapter

### E2E

Senaryo:

```text
User says:
"Arabadan inince bana Tesla kamerasını açmak isteyip istemediğimi sor."

Expected:
Intent correct
↓
Missing info checked
↓
Preview shown
↓
User confirms
↓
Native/fallback setup generated
↓
Automation enabled
```

### Negative tests

- belirsiz araç
- yanlış cihaz
- desteklenmeyen action
- izin reddi
- Tesla authentication failure
- Bluetooth unavailable
- user says "hayır"
- user cancels
- network unavailable

---

## 28. Analytics

Privacy-first eventler:

- onboarding_completed
- builder_started
- voice_used
- clarification_shown
- automation_confirmed
- automation_cancelled
- setup_completed
- setup_failed
- automation_disabled
- execution_failed

İçerik/mesaj gibi hassas veriler varsayılan olarak analytics'e gönderilmemeli.

---

## 29. Başarı Kriterleri

MVP başarılı sayılabilmesi için yeni kullanıcı:

1. Uygulamayı açar.
2. "Arabadan inince bana sor" der.
3. AI'nın özetini anlar.
4. Gerekli tek/az sayıda soruyu cevaplar.
5. Önizlemeyi görür.
6. Onaylar.
7. Native veya açıkça tarif edilen guided setup tamamlanır.
8. Otomasyon listesinde görünür.
9. İstediğinde kapatabilir.

Hedef: Kullanıcıyı teknik workflow tasarımına zorlamamak.

---

## 30. Ürün İçin Temel Tasarım Kararı

Bu uygulamanın merkezinde bir "workflow editor" değil, bir **AI automation conversation** olmalıdır.

Kullanıcı:

> "Arabadan çıkınca bana Tesla kamerasını açmak isteyip istemediğimi sor."

Uygulama:

> "Tamam. Arabadan ayrıldığını Bluetooth bağlantısından anlayacağım. Sonra sana soracağım. Evet dersen desteklenen Tesla kamera işlemini çalıştıracağım. Hayır dersen hiçbir şey yapmayacağım. Bunu oluşturalım mı?"

Bu deneyim ürünün temel UX standardı olmalıdır.

---

## 31. İlk Claude Code Görevi

Claude Code'a ilk etapta tüm uygulamayı tek seferde yazdırma.

İlk prompt:

> "MASTER_SPEC.md ve docs içindeki gereksinimleri analiz et. Önce repository ve hedef platformların capability'lerini incele. Kod yazmadan önce teknik feasibility raporu çıkar. Özellikle iOS Shortcuts/App Intents, Bluetooth disconnect automation, Tesla integration ve Android automation sınırlarını doğrula. Desteklenmeyen hiçbir özelliği varsayma. Ardından Phase 0 için ayrıntılı implementation planı oluştur."

Feasibility onaylandıktan sonra:

> "Phase 1 UX prototype'u oluştur. Önce Home, AI Builder, Clarification, Preview, Confirmation ve Automation Detail ekranlarını geliştir. Teknik workflow editörü kullanma. Kullanıcı doğal dil/ses ile ilerlemeli."

Sonraki aşamada:

> "AI workflow DSL, capability registry ve validator katmanını implement et."

Sonra:

> "iOS native adapter'ını yalnızca doğrulanmış capability'ler için implement et."

---

## 32. Sonuç

Ürünün doğru konumlandırması:

**"Kestirme yapan uygulama" değil.**

**"Ne yapmak istediğini anlayıp telefonunda mümkün olan otomasyonu senin için kuran AI yardımcı."**

Apple ve Android'in teknik sınırları ürünün içine capability/fallback modeliyle işlenmelidir. Böylece uygulama farklı cihazlar ve servisler eklenirken yeniden yazılmak yerine genişleyebilir.

İlk gerçek hedef:
**iPhone + doğal dil + AI clarification + kullanıcı onayı + Bluetooth/araç ayrılma senaryosu + native/guided Shortcut kurulumu.**

Bu temel sağlamlaştırıldıktan sonra WhatsApp, hatırlatmalar, konum, pil, Wi-Fi, takvim, akıllı ev ve diğer otomasyonlar capability olarak eklenmelidir.
