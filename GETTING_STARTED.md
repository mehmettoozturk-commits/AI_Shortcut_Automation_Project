# Başlarken (Mac)

Bu paket, Claude ile yaptığımız Phase 0 → Phase 3A çalışmasının tamamını
içeriyor. Aşağıdaki sıra, kaldığımız yerden Mac'te devam etmek için.

## 1. Önce oku (sırayla)

1. `CLAUDE.md` — çalışma kuralları (son eklenen madde: "Apple'ın teorik
   desteği ≠ bizim kurabilmemiz")
2. `MASTER_SPEC.md` — ürünün tam spesifikasyonu
3. `docs/ux.md`, `docs/capabilities.md`, `docs/intent-entity.md`,
   `docs/ios-bridge.md`, `docs/phase3b-validation-plan.md`

## 2. TS AI Core'u çalıştır (Node.js gerekli — `brew install node` yeterli)

```bash
cd ai-automation
npm install
npm test        # 177/177 görmelisin
npx tsc --noEmit -p tsconfig.json   # typecheck PASS
npm run build:web && open dist-web/index.html   # UX prototipini tarayıcıda aç
```

Bunlar geçmiyorsa bir şey bozulmuş demektir — devam etmeden önce
düzeltilmeli.

## 3. Swift tarafı — BU KISIM HİÇ DERLENMEDİ

`ai-automation/ios-bridge/` klasörü bir Swift Package. Ben bunu hiçbir
zaman derleyemedim (Xcode/Swift toolchain'im yoktu). Mac'te ilk iş:

```bash
cd ai-automation/ios-bridge
swift build
swift test
```

Muhtemelen hata çıkacak — `docs/ios-bridge.md` §6'da "risk taşıyan
noktalar" olarak zaten işaretlediğim yerlere bak (özellikle
`AnyCodable`'ın existential `Sendable` deposu ve `CapabilityRegistry`'nin
`@unchecked Sendable` işaretlemesi). Xcode'da açmak için:

```bash
open Package.swift
```

## 4. Phase 3B — gerçek cihaz testleri

`docs/phase3b-validation-plan.md`'deki 8 testi sırayla çalıştır (Test 1
ve 2 en kritik olanlar — MVP'nin tek dokunuş mu üç adım mı olacağını
belirliyorlar). Sonuçları dokümana ve `docs/capabilities.md`'ye
(evidence seviyesi, `installMethod`) işle.

## 5. Bana geri dönerken

Yeni bir konuşmada devam edeceksen, en hızlı yol: bu klasörü (veya
güncellenmiş halini) tekrar yükleyip "Phase 3B'nin şu testlerini
tamamladım, sonuçlar şöyle" diye özetlemek — `docs/phase3b-validation-plan.md`
zaten hangi bilginin nereye (`capabilities.md`, `ux.md`, `ios-bridge.md`)
işleneceğini tarif ediyor, ben oradan devam edebilirim.

Aynı sohbeti Mac'te "açtım" diyorsan (yani bu konuşmanın kendisi
devam ediyorsa) — ek bir şey yapmana gerek yok, doğrudan yukarıdaki
adımları buradan çalıştırabilirsin; ben de sonuçlarını görüp devam
ederim.
