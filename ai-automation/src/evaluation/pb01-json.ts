/** Bounded JSON grammar reader; objects are constructed only after duplicate-key
 * detection. JSON.parse is used ONLY for isolated string tokens, never objects. */
export const PB01_LIMITS = Object.freeze({ bytes: 65_536, rawDepth: 32, rawNodes: 4096,
  detailDepth: 8, detailNodes: 512, stringBytes: 8192 });
export const PB01_FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export type PB01Json = null | string | number | boolean | PB01Json[] | { [key: string]: PB01Json };
const fail = (code: string): never => { throw new Error(code); };
function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
// Decimal canonicalization catches silent JS rounding/underflow, without treating
// insignificant zeros or exponent spelling as different semantic numbers.
function decimal(text: string): string {
  const negative = text.startsWith("-");
  const [mantissa = "", exponent = "0"] = text.replace(/^-/, "").toLowerCase().split("e");
  const [integer = "", fraction = ""] = mantissa.split(".");
  let digits = (integer + fraction).replace(/^0+/, "");
  if (!digits) return "0";
  let exp = Number(exponent) - fraction.length;
  while (digits.endsWith("0")) { digits = digits.slice(0, -1); exp++; }
  return `${negative ? "-" : ""}${digits}e${exp}`;
}
export function parsePB01Json(text: string): PB01Json {
  if (typeof text !== "string" || !wellFormed(text) || Buffer.byteLength(text, "utf8") > PB01_LIMITS.bytes) fail("json_byte_or_unicode_limit");
  let at = 0, nodes = 0;
  const white = () => { while (at < text.length && /[ \t\r\n]/.test(text[at]!)) at++; };
  function string(): string {
    if (text[at] !== '"') fail("json_string_expected");
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === "\\") { at++; continue; }
      if (c === '"') {
        let value: string;
        try { value = JSON.parse(text.slice(start, at)) as string; } catch { return fail("json_invalid_string"); }
        if (!wellFormed(value) || Buffer.byteLength(value, "utf8") > PB01_LIMITS.stringBytes) fail("json_string_limit");
        return value;
      }
    }
    return fail("json_unterminated_string");
  }
  function read(depth: number): PB01Json {
    if (depth > PB01_LIMITS.rawDepth || ++nodes > PB01_LIMITS.rawNodes) fail("json_structure_limit");
    white(); const c = text[at];
    if (c === '"') return string();
    if (c === "{") {
      at++; white(); const object: { [key: string]: PB01Json } = Object.create(null), keys = new Set<string>();
      if (text[at] === "}") { at++; return object; }
      for (;;) {
        white(); const key = string();
        if (PB01_FORBIDDEN_KEYS.has(key)) fail("json_forbidden_key");
        if (keys.has(key)) fail("json_duplicate_key"); keys.add(key);
        white(); if (text[at++] !== ":") fail("json_colon_expected"); object[key] = read(depth + 1);
        white(); const separator = text[at++];
        if (separator === "}") return object;
        if (separator !== ",") fail("json_separator_expected");
      }
    }
    if (c === "[") {
      at++; white(); const array: PB01Json[] = [];
      if (text[at] === "]") { at++; return array; }
      for (;;) {
        array.push(read(depth + 1)); white(); const separator = text[at++];
        if (separator === "]") return array;
        if (separator !== ",") fail("json_separator_expected");
      }
    }
    for (const [literal, value] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(literal, at)) { at += literal.length; return value; }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at));
    if (!match) return fail("json_value_expected");
    const token = match[0]; at += token.length;
    const value = Number(token);
    if (token.length > 128 || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER || Object.is(value, -0)
      || decimal(token) !== decimal(String(value))) fail("json_unsafe_number");
    return value;
  }
  const result = read(0); white(); if (at !== text.length) fail("json_trailing_data");
  return result;
}
