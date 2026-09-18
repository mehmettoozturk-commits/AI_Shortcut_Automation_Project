/**
 * Tüm kullanıcıya görünen metinler tek dosyada — localization-ready.
 * Phase 3'te bu dosya Localizable.strings / .xcstrings karşılığına
 * çevrilecek. Kod içinde hardcode metin bulunmamalı.
 *
 * MASTER_SPEC §3: teknik terim yok ("trigger", "action", "capability"
 * gibi kelimeler bu dosyada geçmemeli).
 */

export const S = {
  appName: "Otomasyon",
  protoBadge: "UX prototipi",

  tabs: {
    home: "Ana Sayfa",
    automations: "Otomasyonlarım",
    templates: "Şablonlar",
    activity: "Aktivite",
    settings: "Ayarlar",
  },

  fab: "Yeni Otomasyon",

  home: {
    title: "Bugün neyi otomatikleştirelim?",
    subtitle: "Ne istediğini söyle, gerisini birlikte hallederiz.",
    inputPlaceholder: "Ne yapmak istediğini yaz…",
    voice: "Konuş",
    categories: "Nereden başlayalım?",
    recent: "Son otomasyonların",
  },

  categories: [
    { emoji: "🚗", label: "Arabam", prefill: "Arabadan inince " },
    { emoji: "💬", label: "Mesajlar", prefill: "Mesaj gelince " },
    { emoji: "💊", label: "Hatırlatıcılar", prefill: "Her akşam bana hatırlat: " },
    { emoji: "🏠", label: "Ev", prefill: "Eve gelince " },
    { emoji: "📍", label: "Konum", prefill: "Şuraya yaklaşınca " },
    { emoji: "🔋", label: "Telefon", prefill: "Pil azalınca " },
  ],

  capturing: {
    title: "Anlat bakalım",
    send: "Gönder",
    listening: "Dinliyorum…",
    notUnderstood: "Bunu tam anlayamadım. Ne yapmak istediğini biraz daha anlatır mısın?",
    examples: ["Arabadan inince…", "Eve gelince…", "Saat 21'de…"],
    demoNote:
      "Bu prototipte gerçek AI yok — iki örnek senaryo simüle ediliyor: Sentry Mode (otomatik kurulur) ve kamera (son adımı sen yaparsın).",
    demoSentry: "🚗 Sentry Mode örneği",
    demoCamera: "🎥 Kamera örneği",
  },

  understanding: {
    title: "Seni şöyle anladım",
    correct: "✓ Doğru",
    change: "✎ Değiştir",
  },

  unsupported: {
    alternativesIntro: "İstersen desteklenen alternatifleri gösterebilirim:",
    manualIntro: "Dilersen bunu elle de yapabilirsin:",
    revise: "Başka bir şey anlatayım",
  },

  missingInfo: {
    skip: "Şimdilik geç",
  },

  preview: {
    title: "Hazır!",
    create: "Otomasyonu Oluştur",
    createWithPermission: "İzin ver ve oluştur",
    edit: "Düzenle",
    permissionNeeded: (perms: string) => `Bunun için ${perms} iznine ihtiyacım var.`,
    permissionNames: {
      bluetooth: "Bluetooth",
      tesla_account: "Tesla hesabı",
    } as Record<string, string>,
  },

  setup: {
    preparingTitle: "Otomasyonun hazırlanıyor",
    steps: ["Planlandı", "Doğrulandı", "Hazırlanıyor"],
    readyTitle: "Otomasyonun hazır 🎉",
    // Apple'ın kendi ekranına aktarım: tek dokunuş.
    handoffNote: "iPhone güvenlik nedeniyle son kurulumu senin onaylamanı istiyor.",
    handoffButton: "Kestirmelere Ekle",
    waitingTitle: "Kestirmeler açıldı",
    waitingNote:
      "Apple'ın ekranında onayladıktan sonra buraya dön. Kurulumun gerçekleştiğini ben göremiyorum, o yüzden sana sormam gerekiyor.",
    waitingConfirm: "Ekledim",
    waitingFailed: "Ekleyemedim",
    linkingTitle: "Son bir adım kaldı",
    linkingWhy:
      "Kestirmen eklendi. Şimdi iPhone'un otomasyon sekmesinde tetikleyiciyi sen bağlamalısın — bunu iPhone güvenlik nedeniyle biz senin yerine yapamıyoruz.",
    linkingOpenApp: "Kestirmeler'i Aç",
    linkingConfirm: "Bağladım",
    linkingFailed: "Bağlayamadım",
    guidedTitle: "Bunu elle kurman gerekiyor",
    guidedWhy: "Bu işlemin Shortcuts karşılığı yok, ama adımları göstereyim.",
    guidedAck: "Anladım, otomasyonu kaydet",
    failedTitle: "Kurulum tamamlanamadı",
    retry: "Tekrar dene",
  },

  installed: {
    title: "Otomasyonun hazır ✅",
    note: "Artık bunu telefonunun otomasyonlarından kullanabilirsin.",
    continue: "Devam",
  },

  success: {
    title: "Otomasyon eklendi",
    goToList: "Otomasyonlarımı gör",
  },

  automationsExtra: {
    pendingBadge: "Kurulum bekliyor",
    failedBadge: "Kurulamadı",
  },

  automations: {
    title: "Otomasyonlarım",
    subtitle: "Açıp kapatmak için anahtara dokun. Detay için karta dokun.",
    emptyTitle: "Henüz otomasyonun yok.",
    emptyAction: "Ana sayfadan başlayabilirsin",
    manualBadge: "Manuel adım gerekli",
    on: "Açık",
    off: "Kapalı",
    back: "Otomasyonlarım",
    detailWhen: "Ne zaman",
    detailWhat: "Ne olacak",
    detailConfirm: "Onay",
    detailRuns: "Son çalıştırmalar",
  },

  templates: {
    title: "Şablonlar",
    subtitle: "Hazır senaryolardan başla, sonra istediğin gibi değiştir.",
  },

  activity: {
    title: "Aktivite",
    subtitle: "Otomasyonların çalıştığında burada görürsün — başarılı olsun olmasın.",
  },

  settings: {
    title: "Ayarlar",
    subtitle: "Sade tutuyoruz — sadece gerçekten ihtiyacın olanlar.",
    rows: ["Hesap", "Bildirimler", "İzinler", "Gizlilik ve veri", "Hakkında"],
  },

  soon: "Bu senaryo yakında",
} as const;
