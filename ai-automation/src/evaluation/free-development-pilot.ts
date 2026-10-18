import { currentPilotSnapshotHash, parsePilotCases, type PilotCase } from "./free-pilot-contract.js";

// VISIBLE SYNTHETIC DEVELOPMENT ONLY. Authored before baseline observations.
// Not blind, not representative, not independent of the grammar developer.
const requirements = { approval: "not_required" as const, permissions: [], safety: [] };
const notify = (type: string, params: Record<string, unknown>, message?: string): PilotCase["oracle"] => ({
  outcome: "plan", requirements, plan: { name: "Development oracle", trigger: { type, params },
    steps: [message ? { type: "ios.notification.show", params: { message } } : { type: "ios.notification.show" }] },
});
const battery = (n: number, condition = "below", message?: string) => notify("ios.battery.falls_below", { level: n, condition }, message);
const time = (clock: string, message?: string) => notify("ios.time_of_day.daily", { time: clock }, message);
const unknown: PilotCase["oracle"] = { outcome: "unknown", plan: null };
type Row = [string, string, PilotCase["oracle"], PilotCase["category"], PilotCase["polarity"], PilotCase["direction"], PilotCase["slotState"], string?];

export function freeDevelopmentPilot(): PilotCase[] {
  const rows: Row[] = [];
  const batteryRows: Array<[string, number, "below" | "above", string]> = [
    ["Pil %20 altına düşünce bildir",20,"below","strict-battery"],
    ["Batarya yüzde 15 altına düşünce bana haber ver",15,"below","strict-battery"],
    ["Pil %80 üstüne çıkınca bildir",80,"above","strict-battery"],
    ["Şarjım yüzde 20'nin altına düşünce haber ver",20,"below","possessive-charge"],
    ["Pil seviyesi %15'e indiğinde bildirim gönder",15,"below","battery-level-noun"],
    ["Bataryam %30'un altına düşerse beni uyar",30,"below","possessive-battery"],
    ["Pilim yüzde 10'un altına inince bana haber ver",10,"below","possessive-pil"],
    ["Şarj yüzde 25'in altına düştüğünde bildir",25,"below","charge-noun"],
    ["Pil seviyesi yüzde 90'ın üstüne çıktığında uyar",90,"above","battery-level-noun"],
    ["Batarya %70'in üzerine çıkarsa bildirim göster",70,"above","above-variation"],
    ["Şarjım %85'i geçince beni uyar",85,"above","crossing-threshold"],
    ["Pil yüzde 5'in altına inerse haber ver",5,"below","below-variation"],
    ["Bataryam yüzde 40 seviyesinin altına düşünce bildir",40,"below","level-possessive"],
    ["Pilin şarjı yüzde 95'in üzerine çıktığında haber ver",95,"above","battery-charge"],
    ["Şarj seviyesi yüzde 12'nin altına indiğinde beni uyar",12,"below","charge-level"],
  ];
  for (const [input, n, direction, family] of batteryRows) rows.push([input,family,battery(n,direction),"positive","positive",direction,"complete"]);
  const times: Array<[string, string, string]> = [
    ["Saat 08:00 bildir","08:00","strict-time"], ["Saat 23.59 bildirim gönder","23:59","strict-time"],
    ["Saat 00:00 bana haber ver","00:00","strict-time"],
    ["Her gün sabah 8'de bana bildirim gönder","08:00","daily-daypart"],
    ["Akşam 9'da bildirim gönder","21:00","daypart-clock"],
    ["Saat 18.30 olduğunda haber ver","18:30","clock-when"],
    ["Her sabah 07:15'te beni uyar","07:15","daily-daypart"],
    ["Gece 23:00 için bildirim ayarla","23:00","clock-for"],
    ["Günlük 12:45 bildirimini kur","12:45","daily-clock"],
    ["Saat 16:20'de bir bildirim göster","16:20","clock-article"],
    ["Her gün 06.30'da haber ver","06:30","daily-clock"],
    ["Akşam saat 20:10'da beni uyar","20:10","daypart-clock"],
    ["Sabah 09:05 olduğunda bildirim çıkar","09:05","clock-when"],
    ["Saat 14.00 olunca bana haber ver","14:00","clock-becomes"],
    ["Her gece saat 22:30'da bildirim gönder","22:30","daily-daypart"],
  ];
  for (const [input, clock, family] of times) rows.push([input,family,time(clock),"positive","positive","not_applicable","complete"]);
  const notifications: Array<[string, PilotCase["oracle"], string]> = [
    ["Saat 09.00'da bildirim gönder",time("09:00"),"strict-time"],
    ['Saat 09:00\'da "Toplantı zamanı" bildirimi göster',time("09:00","Toplantı zamanı"),"quoted-content"],
    ['Her gün 22:00\'de "İlaç saati" bildirimi gönder',time("22:00","İlaç saati"),"quoted-content"],
    ['Pil %10 altına düşünce "Şarja tak" bildirimi göster',battery(10,"below","Şarja tak"),"quoted-battery-content"],
    ["Saat 18:00'de beni bildirimle uyar",time("18:00"),"notify-rephrase"],
    ["Her gün 08:30'da bildirim çıkar",time("08:30"),"notify-rephrase"],
    ["Pil %25 altına düşünce bana bildirim göster",battery(25),"notify-battery-rephrase"],
    ["Batarya %90 üstüne çıkınca bana bir uyarı gönder",battery(90,"above"),"notify-battery-rephrase"],
    ['Saat 21:00\'de "Su iç" diye bildirim gönder',time("21:00","Su iç"),"quoted-content"],
    ['Pil %15 altına düşünce "Pil azaldı" diye haber ver',battery(15,"below","Pil azaldı"),"quoted-battery-content"],
  ];
  for (const [input, oracle, family] of notifications) rows.push([input,family,oracle,"positive","positive",
    oracle.outcome === "plan" && oracle.plan.trigger.type === "ios.battery.falls_below" ? oracle.plan.trigger.params!.condition as "below" | "above" : "not_applicable","complete"]);
  rows.push(
    ["Pil %75 üstüne çıkınca bildir","direction-control",battery(75,"above"),"negative_direction","positive","above","complete"],
    ["Pil %75 altına düşünce bildir","direction-control",battery(75),"negative_direction","positive","below","complete"],
    ["Pil %20 altına düşünce bildirme","negated-notification",unknown,"negative_direction","negative","below","complete"],
    ["Bildirim gönderme","negated-notification",unknown,"negative_direction","negative","not_applicable","not_applicable"],
    ["Şarjım yüzde 20'nin altına düşmesin","negated-condition",unknown,"negative_direction","negative","below","complete"],
    ["Saat 08:00'de bildirim gönderme","negated-time",unknown,"negative_direction","negative","not_applicable","complete"],
    ["Pil %80 üstüne çıkınca uyarma","negated-notification",unknown,"negative_direction","negative","above","complete"],
    ["Pil %20 altına düşünce haber vermeni istemiyorum","negated-want",unknown,"negative_direction","negative","below","complete"],
    ["Saat 09:00'da bildir ama hafta sonu yapma","restricted-recurrence",unknown,"negative_direction","mixed","not_applicable","complete"],
    ["Pil %20 altına düşünce bildir ve kapıyı kilitleme","mixed-action",unknown,"negative_direction","mixed","below","complete"],
  );
  const clarify = (field: string, reasonCode: string): PilotCase["oracle"] => ({ outcome: "clarification", plan: null, question: { field, reasonCode } });
  rows.push(
    ["Pil azalınca bildir","missing-battery",clarify("battery_level","required_for_battery_trigger"),"ambiguous_slot","positive","below","missing"],
    ["Saat gelince bildirim gönder","missing-time",clarify("time","required_for_time_trigger"),"ambiguous_slot","positive","not_applicable","missing"],
    ["Saat 9'da bildir","ambiguous-daypart",clarify("time_of_day","am_pm_ambiguous"),"ambiguous_slot","positive","not_applicable","missing"],
    ["Pil %20 ve %80 olduğunda bildir","multiple-battery",unknown,"ambiguous_slot","positive","unspecified","multiple"],
    ["Saat 08:00 ve 09:00'da bildir","multiple-time",unknown,"ambiguous_slot","positive","not_applicable","multiple"],
    ["Tesla kameralarını aç","unsupported-camera",unknown,"unsupported","positive","not_applicable","not_applicable","Tesla live camera"],
    ["Telefon şifresini otomatik değiştir","unsupported-system",unknown,"unsupported","positive","not_applicable","not_applicable","Device password change"],
    ["Pil %20 altına düşünce banka transferi yap","unsupported-finance",unknown,"unsupported","positive","below","complete","Bank transfer"],
    ["Saat 08:00'de Face ID kontrolünü atla","unsupported-security",unknown,"unsupported","positive","not_applicable","complete","Bypass Face ID"],
    ["Arabadan inince gizli kamera yayını başlat","unsupported-camera",unknown,"unsupported","positive","disconnected","not_applicable","Hidden camera stream"],
  );
  return parsePilotCases(rows.map(([input, family, oracle, category, polarity, direction, slotState, requestedConcept], i) => ({
    schemaVersion: 1, oracleVersion: "visible-dev-v1", capabilitySnapshotHash: currentPilotSnapshotHash(),
    caseId: `free-dev-${String(i + 1).padStart(2,"0")}`, input,
    sourceId: "codex-visible-authoring-2026-10-18", authorId: "codex-visible-developer", generatorVersion: "manually-authored-no-api-v1",
    promptFamilyId: `visible-${family}`, expressionFamilyId: family, numericFamilyId: family,
    split: "development", reviewStatus: "draft", category,
    capabilityId: category === "unsupported" ? null : oracle.outcome === "plan" ? oracle.plan.trigger.type
      : family.includes("time") || family.includes("daypart") || family.includes("recurrence") ? "ios.time_of_day.daily" : "ios.battery.falls_below",
    ...(requestedConcept ? { requestedConcept } : {}), polarity, direction, slotState, slotAnnotations: [], oracle,
  })));
}
