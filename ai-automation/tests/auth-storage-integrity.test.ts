import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { AuthDataIntegrityError, FileBackedAuthRepository } from "../src/api/auth/repository.js";

const now = "2026-10-14T00:00:00.000Z";
const user = { id: "user", appleSubject: "apple-subject", createdAt: now };
const session = { id: "session", userId: "user", tokenHash: "legacy-hash", createdAt: now, expiresAt: "2027-01-01T00:00:00.000Z" };
const challenge = { id: "challenge", nonceHash: "legacy-nonce", expiresAt: "2027-01-01T00:00:00.000Z" };
const valid = () => ({ users: [user], sessions: [session], challenges: [challenge] });
const fixtures: [string, unknown][] = [
  ["empty object", {}], ["null root", null], ["array root", []],
  ["missing users", { sessions: [], challenges: [] }],
  ["wrong sessions type", { users: [], sessions: {}, challenges: [] }],
  ["missing challenges", { users: [], sessions: [] }],
  ["null user", { ...valid(), users: [null] }],
  ["missing subject", { ...valid(), users: [{ id: "user", createdAt: now }] }],
  ["wrong subject type", { ...valid(), users: [{ ...user, appleSubject: 12 }] }],
  ["missing session expiry", { ...valid(), sessions: [{ id: "session", userId: "user", tokenHash: "hash", createdAt: now }] }],
  ["wrong token type", { ...valid(), sessions: [{ ...session, tokenHash: false }] }],
  ["wrong revoked type", { ...valid(), sessions: [{ ...session, revokedAt: 1 }] }],
  ["missing challenge nonce", { ...valid(), challenges: [{ id: "challenge", expiresAt: now }] }],
  ["invalid purpose", { ...valid(), challenges: [{ ...challenge, purpose: "delete_everything" }] }],
  ["wrong receipt type", { ...valid(), deletionReceipts: {} }],
  ["incomplete receipt", { ...valid(), deletionReceipts: [{ deletionId: "receipt" }] }],
  ["duplicate subject", { ...valid(), users: [user, { ...user, id: "other" }] }],
];

describe("RH-07-AUTH-P1 existing auth storage integrity", () => {
  it.each(fixtures)("fails closed on %s and preserves original bytes across restart", (_label, input) => {
    const directory = mkdtempSync(join(tmpdir(), "auth-integrity-"));
    const path = join(directory, "auth.json");
    const bytes = Buffer.from(JSON.stringify(input));
    try {
      writeFileSync(path, bytes);
      for (let restart = 0; restart < 2; restart++) {
        expect(() => new FileBackedAuthRepository(path)).toThrow(AuthDataIntegrityError);
        expect(readFileSync(path)).toEqual(bytes);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("malformed JSON fails without modifying bytes", () => {
    const directory = mkdtempSync(join(tmpdir(), "auth-integrity-"));
    const path = join(directory, "auth.json");
    try {
      writeFileSync(path, "{broken");
      expect(() => new FileBackedAuthRepository(path)).toThrow();
      expect(readFileSync(path, "utf8")).toBe("{broken");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("missing file starts empty without writing until explicit mutation", () => {
    const directory = mkdtempSync(join(tmpdir(), "auth-integrity-"));
    const path = join(directory, "auth.json");
    try {
      const repo = new FileBackedAuthRepository(path);
      expect(existsSync(path)).toBe(false);
      expect(repo.findUserById("user")).toBeNull();
      repo.createChallenge("challenge", "nonce", "2027-01-01T00:00:00.000Z");
      expect(existsSync(path)).toBe(true);
      expect(() => new FileBackedAuthRepository(path)).not.toThrow();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("legacy optional fields and unknown extensions survive load and mutation", () => {
    const directory = mkdtempSync(join(tmpdir(), "auth-integrity-"));
    const path = join(directory, "auth.json");
    const data = { ...valid(), extension: { keep: true }, users: [{ ...user, custom: "keep" }] };
    const bytes = JSON.stringify(data, null, 2);
    try {
      writeFileSync(path, bytes);
      const repo = new FileBackedAuthRepository(path);
      expect(readFileSync(path, "utf8")).toBe(bytes);
      expect(repo.findSession("legacy-hash", now)?.id).toBe("session");
      expect(repo.consumeChallenge("challenge", "legacy-nonce", now)).toBe(true);
      const updated = JSON.parse(readFileSync(path, "utf8"));
      expect(updated.extension).toEqual({ keep: true });
      expect(updated.users[0].custom).toBe("keep");
      expect(new FileBackedAuthRepository(path).deleteUserAndSessions("user")).toBe(true);
      expect(new FileBackedAuthRepository(path).findSession("legacy-hash", now)).toBeNull();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
