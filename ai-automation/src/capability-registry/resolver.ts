/**
 * Capability Resolver — Phase 1.5.
 *
 * Ürün kararı (üç seviyeli araç yaklaşımı):
 *   CarPlay varsa    → tercih edilen tetikleyici (priority 1)
 *   CarPlay yoksa    → Bluetooth fallback (priority 2)
 *   Kullanıcı isterse→ konum tabanlı alternatif (priority 3, eşdeğer DEĞİL)
 *
 * Kritik nokta: sistem "Bluetooth kullan" diye körü körüne karar vermez.
 * Öncelik registry'deki `priority` alanından okunur; Apple yeni bir
 * capability sunduğunda UX veya AI değişmeden sadece registry güncellenir.
 */

import { capabilitiesInGroup } from "./registry.js";
import { behaviorFor } from "./behavior.js";
import type { Capability } from "./types.js";

export interface DeviceContext {
  /** Cihazın iOS ana sürümü, örn. 26 */
  osVersion: number;
  hasCarPlay: boolean;
  /** Kullanıcı sürekli konum iznini vermeye razı mı? */
  allowsAlwaysLocation?: boolean;
  /** Kullanıcı açıkça konum tabanlı alternatifi seçtiyse */
  prefersLocationTrigger?: boolean;
}

export interface ResolutionResult {
  capability: Capability;
  /** Kullanıcıya ÖNCEDEN gösterilecek uyarılar (sürpriz bırakmamak için) */
  disclosures: string[];
  /** Denenip elenen adaylar ve eleme nedeni — hata ayıklama/şeffaflık */
  rejected: Array<{ id: string; reason: string }>;
}

function isEligible(cap: Capability, ctx: DeviceContext): string | null {
  if (cap.id === "ios.carplay.disconnected" && !ctx.hasCarPlay) {
    return "Cihazda CarPlay yok";
  }
  if (cap.permissions.includes("location_always") && ctx.allowsAlwaysLocation !== true) {
    return "Sürekli konum izni yok";
  }
  if (cap.id === "ios.location.leave" && ctx.prefersLocationTrigger !== true) {
    return "Konum tabanlı alternatif kullanıcı tarafından seçilmedi";
  }
  if (!cap.nativeSupport) {
    return "Native destek yok";
  }
  return null;
}

/**
 * Bir tetikleyici grubu için cihaz bağlamına göre en uygun capability'yi
 * seçer. Hiçbiri uygun değilse null döner — bu durumda UI dürüst bir
 * "bunu bu cihazda yapamıyorum" mesajı göstermelidir (docs/ux.md §7.3).
 */
export function resolveTrigger(group: string, ctx: DeviceContext): ResolutionResult | null {
  const candidates = capabilitiesInGroup(group);
  const rejected: Array<{ id: string; reason: string }> = [];

  for (const cap of candidates) {
    const reason = isEligible(cap, ctx);
    if (reason) {
      rejected.push({ id: cap.id, reason });
      continue;
    }
    return { capability: cap, disclosures: disclosuresFor(cap, ctx), rejected };
  }
  return null;
}

/**
 * Kullanıcıya önceden söylenmesi gerekenler. Statik `userDisclosures`'a
 * ek olarak, cihazın iOS sürümüne göre gerçekleşen davranış eklenir —
 * iki onay çıkacaksa bu sürpriz olmamalı.
 */
export function disclosuresFor(cap: Capability, ctx: DeviceContext): string[] {
  const out = [...(cap.userDisclosures ?? [])];
  const behavior = behaviorFor(cap, ctx.osVersion);

  if (behavior?.canRunWithoutAsking === false) {
    out.push(
      "Bu otomasyon her çalıştığında iPhone sana ayrıca onay soracak; bu iOS'un kendi davranışı ve kapatılamıyor."
    );
  }
  if (behavior?.canRunWithoutAsking === "unverified") {
    out.push(
      "Bu otomasyonun iPhone tarafından ek onay isteyip istemediğini henüz kesin olarak bilmiyoruz."
    );
  }
  if (cap.requiresUserSetupStep) {
    out.push("Kurulumun son adımını senin onaylaman gerekiyor.");
  }
  return out;
}
