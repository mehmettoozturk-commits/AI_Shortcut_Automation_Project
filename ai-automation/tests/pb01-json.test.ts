import { expect, it } from "vitest";
import { parsePB01Json, PB01_LIMITS } from "../src/evaluation/pb01-json.js";

it.each(['null', 'true', 'false', '0', '1.25', '1e3', '"Türkçe 😀"', '[null,"",{},[]]', '{"a":1,"b":[2]}'])("parses bounded JSON %s", text => {
  expect(parsePB01Json(text)).toEqual(JSON.parse(text));
});
it.each(['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"nested":{"x":null,"x":false}}', '{"a":[{"key":1,"key":2}]}'])("rejects duplicate raw keys: %s", text => {
  expect(() => parsePB01Json(text)).toThrow("json_duplicate_key");
});
it.each(["__proto__", "constructor", "prototype"])("rejects forbidden raw key %s at any depth", key => {
  expect(() => parsePB01Json(`{"nested":{"${key}":1}}`)).toThrow("json_forbidden_key");
});
it.each(['{"\\u005f_proto__":1}', '"\\ud800"', '"\\udfff"', '"\\u000g"', '"x\n"', '"\\q"', '"unterminated', '[1,]', '{"a":1,}', '{"a" 1}', '[true false]', '01', '+1', '.2', '1.', 'NaN', 'Infinity', 'undefined', 'true false', '\ufeff{}', '{a:1}'])("rejects invalid grammar or unicode %s", text => {
  expect(() => parsePB01Json(text)).toThrow();
});
it.each(['9007199254740992', '9007199254740991.1', '0.10000000000000001', '-0', '1e309', '1e-999', '-9007199254740992'])("rejects lossy/unsafe number %s", text => {
  expect(() => parsePB01Json(text)).toThrow("json_unsafe_number");
});
it("preserves valid escapes and semantic decimal exponent values", () => {
  expect(parsePB01Json('"\\ud83d\\ude00\\n\\\"\\\\"')).toBe('😀\n"\\');
  expect(parsePB01Json('10.000e-1')).toBe(1); expect(parsePB01Json('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
});
it("byte/string/depth/item bounds have explicit rejection without truncation", () => {
  expect(parsePB01Json('"' + 'a'.repeat(PB01_LIMITS.stringBytes) + '"')).toHaveLength(PB01_LIMITS.stringBytes);
  expect(() => parsePB01Json('"' + 'a'.repeat(PB01_LIMITS.stringBytes + 1) + '"')).toThrow("json_string_limit");
  expect(parsePB01Json('['.repeat(32) + '0' + ']'.repeat(32))).toBeDefined();
  expect(() => parsePB01Json('['.repeat(33) + '0' + ']'.repeat(33))).toThrow("json_structure_limit");
  expect(() => parsePB01Json('[' + Array(4096).fill('0').join(',') + ']')).toThrow("json_structure_limit");
  expect(() => parsePB01Json(' '.repeat(PB01_LIMITS.bytes) + '0')).toThrow("json_byte_or_unicode_limit");
  expect(parsePB01Json(' '.repeat(PB01_LIMITS.bytes - 1) + '0')).toBe(0);
});
it("500 deterministic generated JSON trees match the standard parser within admitted bounds", () => {
  let seed = 1701; const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const value = (depth: number): unknown => {
    const kind = depth === 0 ? next() % 4 : next() % 6;
    if (kind === 0) return null;
    if (kind === 1) return Boolean(next() % 2);
    if (kind === 2) return (next() % 10000) / 10;
    if (kind === 3) return ['comma,:{}[]', 'quote"\\', 'Türkçe 😀', '\n\t', ''][next() % 5];
    if (kind === 4) return Array.from({ length: next() % 4 }, () => value(depth - 1));
    return Object.fromEntries(Array.from({ length: next() % 4 }, (_, i) => [`key${i}`, value(depth - 1)]));
  };
  for (let i = 0; i < 500; i++) {
    const raw = JSON.stringify(value(4)); expect(parsePB01Json(raw)).toEqual(JSON.parse(raw));
  }
});
