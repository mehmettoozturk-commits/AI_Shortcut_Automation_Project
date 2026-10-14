import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileBackedAuthRepository, InMemoryAuthRepository } from "../src/api/auth/repository.js";
import { AuthService } from "../src/api/auth/service.js";
vi.mock("node:fs", async original => { const actual = await original<typeof import("node:fs")>(); return { ...actual, writeFileSync: vi.fn(actual.writeFileSync), renameSync: vi.fn(actual.renameSync) }; });
afterEach(() => vi.clearAllMocks());
const now = new Date().toISOString(); const expiry = "2030-01-01T00:00:00.000Z"; const binding = "a".repeat(64);
function setup() { const r = new InMemoryAuthRepository(); r.createChallenge("login", "nonce", expiry); r.createChallenge("create", "nonce", expiry, "account_creation", binding); return r; }
function disk() { const dir = mkdtempSync(join(tmpdir(), "rh04-challenge-")); const path = join(dir, "auth.json"); return { dir, path, r: new FileBackedAuthRepository(path) }; }
describe("Purpose-bound atomic challenges", () => {
  it("E01 legacy challenges default only to login", () => { const x = disk(); try { writeFileSync(x.path, JSON.stringify({ users: [], sessions: [], challenges: [{ id: "legacy", nonceHash: "nonce", expiresAt: expiry }] })); const r = new FileBackedAuthRepository(x.path); expect(r.consumeChallenge("legacy", "nonce", now, "account_creation", binding)).toBe(false); expect(r.consumeChallenge("legacy", "nonce", now)).toBe(true); } finally { rmSync(x.dir, { recursive: true, force: true }); } });
  it("E02 consumes login purpose", () => expect(setup().consumeChallenge("login", "nonce", now, "login")).toBe(true));
  it("E03 consumes creation purpose with binding", () => expect(setup().consumeChallenge("create", "nonce", now, "account_creation", binding)).toBe(true));
  it("E04 cannot consume login for creation", () => expect(setup().consumeChallenge("login", "nonce", now, "account_creation", binding)).toBe(false));
  it("E05 cannot consume creation for login", () => expect(setup().consumeChallenge("create", "nonce", now)).toBe(false));
  it("E06 rejects wrong ticket hash", () => expect(setup().consumeChallenge("create", "nonce", now, "account_creation", "b".repeat(64))).toBe(false));
  it("E07 purpose mismatch preserves usability", () => { const r = setup(); r.consumeChallenge("login", "nonce", now, "account_creation", binding); expect(r.consumeChallenge("login", "nonce", now)).toBe(true); });
  it("E08 binding mismatch preserves usability", () => { const r = setup(); r.consumeChallenge("create", "nonce", now, "account_creation", "b".repeat(64)); expect(r.consumeChallenge("create", "nonce", now, "account_creation", binding)).toBe(true); });
  it("E09 rejects replay", () => { const r = setup(); expect(r.consumeChallenge("login", "nonce", now)).toBe(true); expect(r.consumeChallenge("login", "nonce", now)).toBe(false); });
  it("E10 rejects at exact expiry", () => expect(setup().consumeChallenge("login", "nonce", expiry)).toBe(false));
  it.each(["write", "rename"])("E11/E12 %s failure leaves challenge usable", stage => { const x = disk(); try { x.r.createChallenge("id", "nonce", expiry); const before = readFileSync(x.path, "utf8"); if (stage === "write") vi.mocked(writeFileSync).mockImplementationOnce(() => { throw new Error("write"); }); else vi.mocked(renameSync).mockImplementationOnce(() => { throw new Error("rename"); }); expect(() => x.r.consumeChallenge("id", "nonce", now)).toThrow(); expect(readFileSync(x.path, "utf8")).toBe(before); expect(x.r.consumeChallenge("id", "nonce", now)).toBe(true); } finally { rmSync(x.dir, { recursive: true, force: true }); } });
  it("E13 restart retains used state", () => { const x = disk(); try { x.r.createChallenge("id", "nonce", expiry); x.r.consumeChallenge("id", "nonce", now); expect(new FileBackedAuthRepository(x.path).consumeChallenge("id", "nonce", now)).toBe(false); } finally { rmSync(x.dir, { recursive: true, force: true }); } });
  it("E14 restart retains unused state on failure", () => { const x = disk(); try { x.r.createChallenge("id", "nonce", expiry); vi.mocked(renameSync).mockImplementationOnce(() => { throw new Error("rename"); }); expect(() => x.r.consumeChallenge("id", "nonce", now)).toThrow(); expect(new FileBackedAuthRepository(x.path).consumeChallenge("id", "nonce", now)).toBe(true); } finally { rmSync(x.dir, { recursive: true, force: true }); } });
  it("E15 preserves other challenges", () => { const r = setup(); r.consumeChallenge("login", "nonce", now); expect(r.consumeChallenge("create", "nonce", now, "account_creation", binding)).toBe(true); });
  it("E16 stores ticket hash without plaintext ticket", () => { const x = disk(); try { const token = "synthetic-opaque-ticket"; const hash = createHash("sha256").update(token).digest("hex"); x.r.createChallenge("id", "nonce", expiry, "account_creation", hash); const raw = readFileSync(x.path, "utf8"); expect(raw).not.toContain(token); expect(raw).toContain(hash); } finally { rmSync(x.dir, { recursive: true, force: true }); } });
  it("E17 normal AuthService login remains compatible", async () => { const r = new InMemoryAuthRepository(); const auth = new AuthService(r, { verify: async () => ({ subject: "a", issuer: "https://appleid.apple.com", audience: "com.aishortcut.AutomationApp", issuedAt: 1, expiresAt: 9_999_999_999 }) }); const c = auth.challenge(); expect(await auth.signIn("test", c.challengeId, c.nonce)).not.toBeNull(); });
  it("E18 missing creation binding fails closed", () => { const r = setup(); expect(r.consumeChallenge("create", "nonce", now, "account_creation")).toBe(false); expect(() => r.createChallenge("missing", "nonce", expiry, "account_creation")).toThrow(); });
});
