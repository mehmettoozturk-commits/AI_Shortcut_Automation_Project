/**
 * Türkçe zaman/sayı normalizasyonu (§5, §12).
 *
 * Kural: AM/PM belirsizliği ASLA sessizce tahmin edilmez. "9'da" tek
 * başına geçtiğinde sonuç `ambiguous: true` olur ve clarification
 * motoru "Sabah 9 mu, akşam 9 mu?" sorusunu üretir.
 */

import type { Normalized, Recurrence } from "./types.js";

const NUMBER_WORDS: Record<string, number> = {
  sıfır: 0, bir: 1, iki: 2, üç: 3, dört: 4, beş: 5, altı: 6, yedi: 7,
  sekiz: 8, dokuz: 9, on: 10, onbir: 11, oniki: 12, "on bir": 11, "on iki": 12,
  yirmi: 20, otuz: 30, kırk: 40, elli: 50, altmış: 60, yetmiş: 70, seksen: 80, doksan: 90,
  yüz: 100,
};

const WEEKDAYS: Record<string, number> = {
  pazartesi: 1, salı: 2, çarşamba: 3, perşembe: 4, cuma: 5, cumartesi: 6, pazar: 0,
};

export function lower(input: string): string {
  return input.toLocaleLowerCase("tr");
}

/** "yirmi", "yüzde yirmi", "20" → 20 */
export function parseTurkishNumber(text: string): number | null {
  const t = lower(text);
  const digits = t.match(/(\d{1,3})/);
  if (digits) return Number(digits[1]);

  // Türkçe ekleri soyarak sözcük eşlemesi: "dokuzda" → dokuz,
  // "yirmiye" → yirmi, "onda" → on.
  const stripSuffix = (w: string): string | null => {
    if (w in NUMBER_WORDS) return w;
    const candidates = Object.keys(NUMBER_WORDS)
      .filter((k) => w.startsWith(k))
      .sort((a, b) => b.length - a.length);
    return candidates[0] ?? null;
  };

  const words = t
    .split(/\s+/)
    .map(stripSuffix)
    .filter((w): w is string => w !== null);
  if (words.length === 0) return null;
  let total = 0;
  for (const w of words) {
    const v = NUMBER_WORDS[w]!;
    if (v >= 20) total += v;
    else total += v;
  }
  return total > 0 || words.includes("sıfır") ? total : null;
}

/** Günün hangi bölümünden bahsedildiği; AM/PM çözümü için. */
function dayPart(text: string): "morning" | "evening" | null {
  const t = lower(text);
  if (/(sabah|öğlen|öğle|kahvalt)/.test(t)) return "morning";
  if (/(akşam|gece|öğleden sonra|yatarken)/.test(t)) return "evening";
  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Saat ifadesini normalize eder. Belirsizlik varsa `ambiguous: true`
 * döner ve `value` 24 saatlik sabah yorumunu taşır (gösterim için),
 * ama çağıran taraf bunu KESİN kabul etmemelidir.
 */
export function normalizeTime(input: string): Normalized<string> | null {
  const t = lower(input);

  // "21:00", "9.30"
  const explicit = t.match(/(\d{1,2})[:.](\d{2})/);
  if (explicit) {
    const h = Number(explicit[1]);
    const m = Number(explicit[2]);
    if (h > 23 || m > 59) return null;
    return { value: `${pad(h)}:${pad(m)}`, raw: explicit[0] };
  }

  // "saat dokuz", "akşam dokuzda", "9'da", "saat 21"
  const hourMatch =
    t.match(/saat\s+([a-zçğıöşü]+|\d{1,2})/) ??
    t.match(/(\d{1,2})['’]?\s*(?:de|da|te|ta)\b/) ??
    t.match(/\b(bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on|on bir|on iki)['’]?\s*(?:de|da|te|ta)\b/);
  if (!hourMatch) return null;

  const hour = parseTurkishNumber(hourMatch[1]!);
  if (hour === null || hour > 23) return null;

  const part = dayPart(t);
  if (hour === 0 || hour > 12) {
    return { value: `${pad(hour)}:00`, raw: hourMatch[0] };
  }
  if (part === "evening") {
    return { value: `${pad(hour === 12 ? 12 : hour + 12)}:00`, raw: hourMatch[0] };
  }
  if (part === "morning") {
    return { value: `${pad(hour)}:00`, raw: hourMatch[0] };
  }
  // Belirsiz: sabah mı akşam mı bilinmiyor.
  return { value: `${pad(hour)}:00`, raw: hourMatch[0], ambiguous: true };
}

export function normalizeRecurrence(input: string): Normalized<Recurrence> | null {
  const t = lower(input);

  const weekdayEntry = Object.entries(WEEKDAYS).find(([name]) => t.includes(name));
  if (weekdayEntry && /her/.test(t)) {
    return { value: { kind: "weekly", weekdays: [weekdayEntry[1]] }, raw: `her ${weekdayEntry[0]}` };
  }
  if (/hafta içi/.test(t)) return { value: { kind: "weekday" }, raw: "hafta içi" };

  const perWeek = t.match(/haftada\s+(\d+|[a-zçğıöşü]+)\s*(?:gün|kere|kez|defa)/);
  if (perWeek) {
    const count = parseTurkishNumber(perWeek[1]!);
    if (count !== null) return { value: { kind: "times_per_week", count }, raw: perWeek[0] };
  }

  if (/(her gün|her akşam|her sabah|her gece|günlük)/.test(t)) {
    const raw = t.match(/(her gün|her akşam|her sabah|her gece|günlük)/)![0];
    return { value: { kind: "daily" }, raw };
  }
  return null;
}

export function normalizeDate(input: string): Normalized<string> | null {
  const t = lower(input);
  if (/yarın/.test(t)) return { value: "tomorrow", raw: "yarın" };
  if (/bugün/.test(t)) return { value: "today", raw: "bugün" };
  if (/(öbür gün|ertesi gün)/.test(t)) return { value: "day_after_tomorrow", raw: "öbür gün" };
  const weekdayEntry = Object.entries(WEEKDAYS).find(([name]) => t.includes(name));
  if (weekdayEntry && !/her/.test(t)) {
    return { value: `weekday:${weekdayEntry[1]}`, raw: weekdayEntry[0] };
  }
  return null;
}
