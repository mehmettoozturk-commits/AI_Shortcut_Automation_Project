# CLAUDE.md

Bu repository AI destekli, kullanıcıların doğal dil ile mobil otomasyon/kestirme oluşturmasını sağlayan bir üründür.

## Çalışma kuralları

- Önce MASTER_SPEC.md ve docs/ dosyalarını oku.
- Kodlamadan önce mevcut repository'yi ve platform capability'lerini analiz et.
- Apple/Android tarafından desteklenmeyen bir özelliği varsayma.
- AI çıktısını doğrudan çalıştırma; schema + capability + permission validation kullan.
- Her capability için unit/integration test yaz.
- Kullanıcı onayı gerektiren işlemleri otomatik onaysız çalıştırma.
- Unsupported işlemler için guided setup/fallback üret.
- Secret/token/log hassas verilerini commit etme.
- UI sade, erişilebilir ve teknik terimlerden uzak olmalı.
- Bir milestone bitmeden sonraki milestone'a geçme.
- Testler başarısızsa "tamamlandı" deme.
- Gerçek cihaz entegrasyonu mümkün değilse mock kullan ve bunu açıkça belirt.
- **Apple'ın teorik olarak desteklemesi ≠ bizim uygulamamızın gerçekten kurabilmesi.** Bir capability Apple dokümanında "destekleniyor" diye geçiyorsa bu yalnızca o capability'nin VAR OLDUĞU anlamına gelir; uygulamamızın onu programatik/tek dokunuşla kurabildiği anlamına GELMEZ (bkz. docs/capabilities.md §1.2, docs/ios-bridge.md §5). Bu ikisi ayrı doğrulama gerektirir. `docs/phase3b-validation-plan.md`'deki 8 test tamamlanıp sonuçlar `docs/capabilities.md`'ye (evidence seviyesi, installMethod) işlenmeden, hiçbir capability veya kurulum yöntemi "çalışıyor" varsayılıp ona göre implementation yapılamaz — Apple dokümanı `evidence: "apple_docs"` verir ama `installMethod`/`SetupKind` kararını vermez; o karar yalnızca gerçek cihaz testinden gelir.
