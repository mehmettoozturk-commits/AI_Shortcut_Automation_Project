/**
 * OS sürümüne göre davranış çözümleme — Phase 1.5.
 *
 * Neden gerekli: Bluetooth tetikleyicisi iOS 15'te onaysız
 * çalıştırılamıyordu, iOS 26'da çalıştırılabiliyor. Aynı capability,
 * farklı cihazda farklı davranıyor. Tek bir boolean bu gerçeği
 * temsil edemez.
 */

import type { Capability, OSBehavior } from "./types.js";

/**
 * Cihazın sürümü için geçerli davranış kaydı: minOSVersion'ı cihaz
 * sürümünden küçük veya eşit olan en yüksek kayıt. Hiç kayıt yoksa
 * (veya cihaz sürümü tüm kayıtların altındaysa) null döner — bu
 * "bilmiyoruz" anlamına gelir, "çalışır" anlamına GELMEZ.
 */
export function behaviorFor(cap: Capability, osVersion: number): OSBehavior | null {
  const applicable = cap.behaviors
    .filter((b) => b.minOSVersion <= osVersion)
    .sort((a, b) => b.minOSVersion - a.minOSVersion);
  return applicable[0] ?? null;
}

/**
 * Bu cihazda otomasyon kullanıcıya ek onay sormadan çalışabilir mi?
 * Bilinmiyorsa "unverified" döner; çağıran taraf bunu asla `true` gibi
 * yorumlamamalıdır.
 */
export function canRunWithoutAsking(cap: Capability, osVersion: number): true | false | "unverified" {
  const behavior = behaviorFor(cap, osVersion);
  return behavior ? behavior.canRunWithoutAsking : "unverified";
}
