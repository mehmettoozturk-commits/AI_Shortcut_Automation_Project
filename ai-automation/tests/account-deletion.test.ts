import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/api/auth/service.js";
import { AuthPersistenceNotCommittedError, FileBackedAuthRepository, InMemoryAuthRepository } from "../src/api/auth/repository.js";
import { CreationTicketStore } from "../src/api/auth/creation-tickets.js";
import { createPlanServer } from "../src/api/server.js";
import type { RevocationAdapter } from "../src/api/auth/revocation.js";
import type { VerifiedAppleIdentity } from "../src/api/auth/types.js";

const servers: Server[] = [];
const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
const subject = "synthetic-apple-subject";
const identity = (): VerifiedAppleIdentity => ({ subject, issuer: "https://appleid.apple.com", audience: "com.aishortcut.AutomationApp", issuedAt: 1, expiresAt: 9_999_999_999 });
async function fixture(repo = new InMemoryAuthRepository(), revocation?: RevocationAdapter, options: Parameters<typeof createPlanServer>[0] = {}) {
  let now = Date.now();
  const tickets = new CreationTicketStore(() => now);
  const verify = vi.fn(async (token: string, _aud: string, nonce: string): Promise<VerifiedAppleIdentity | null> => {
    const claims = JSON.parse(token) as { subject: string; nonce: string };
    return claims.nonce === nonce ? { ...identity(), subject: claims.subject } : null;
  });
  const auth = new AuthService(repo, { verify }, () => now, tickets, revocation);
  const user = repo.getOrCreateUser(subject, new Date(now).toISOString());
  const server = createPlanServer({ ...options, auth }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("address");
  const base = `http://127.0.0.1:${address.port}`;
  const send = (path: string, body: unknown = {}, token?: string, method = "POST") => fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const proof = (c: { challengeId: string; nonce: string }, sub = subject) => ({ challengeId: c.challengeId, nonce: c.nonce, identityToken: JSON.stringify({ subject: sub, nonce: c.nonce }) });
  async function login() { const c = await (await send("/auth/apple/challenge")).json(); return send("/auth/apple", { ...proof(c), accountCreationSupported: true }); }
  const token = (await (await login()).json()).sessionToken as string;
  async function deletion() { const requestId = randomUUID(); const response = await send("/auth/deletion-challenges", { requestId }, token); expect(response.status).toBe(200); const c = await response.json(); return { ...proof(c), requestId, confirmDelete: true }; }
  const remove = (body: unknown, bearer: string | undefined = token) => send("/auth/account", body, bearer, "DELETE");
  return { repo, auth, tickets, verify, user, token, server, base, send, proof, login, deletion, remove, advance: (ms: number) => { now += ms; }, now: () => now };
}
function fileRepo() { const directory = mkdtempSync(join(tmpdir(), "rh04-delete-")); directories.push(directory); const path = join(directory, "auth.json"); return { path, repo: new FileBackedAuthRepository(path) }; }

describe("RH-04 explicit account deletion", () => {
  async function independentSession(x: Awaited<ReturnType<typeof fixture>>) {
    const user = x.repo.getOrCreateUser("independent-subject", new Date(x.now()).toISOString());
    const result = await x.auth.prepareAccountCreation(x.proof(x.auth.challenge(), "independent-subject"));
    if (result?.status !== "signed_in") throw new Error("fixture session");
    return { user, token: result.sessionToken };
  }
  it("RH04-R1 proven precommit receipt failure preserves pending status without global recovery", async () => {
    const x = await fixture(new InMemoryAuthRepository(), { configured: true, revoke: async () => "succeeded" });
    const other = await independentSession(x);
    vi.spyOn(x.repo, "updateRevocationStatus").mockImplementationOnce(() => { throw new AuthPersistenceNotCommittedError(new Error("fixture precommit")); });
    const result = await (await x.remove(await x.deletion())).json();
    expect(result.appleRevocation.status).toBe("pending");
    expect(x.repo.findDeletionReceipt(result.deletionId, new Date(x.now()).toISOString())?.revocationStatus).toBe("pending");
    expect(x.auth.session(other.token)?.userId).toBe(other.user.id);
    expect((await x.send("/auth/apple/challenge")).status).toBe(200);
  });
  it("RH04-R2 ambiguous postcommit receipt failure distrusts another active user", async () => {
    const f = fileRepo();
    const x = await fixture(f.repo, { configured: true, revoke: async () => "succeeded" });
    const other = await independentSession(x);
    const update = x.repo.updateRevocationStatus.bind(x.repo);
    vi.spyOn(x.repo, "updateRevocationStatus").mockImplementationOnce((...args) => { update(...args); throw new Error("fixture postcommit uncertainty"); });
    const result = await (await x.remove(await x.deletion())).json();
    expect(result.appleRevocation.status).toBe("pending");
    expect(x.repo.findUserById(other.user.id)).not.toBeNull();
    expect(() => x.auth.session(other.token)).toThrow("Auth storage recovery required.");
    expect((await x.send("/auth/apple/challenge")).status).toBe(500);
    const recovered = new AuthService(new FileBackedAuthRepository(f.path), { verify: x.verify }, () => x.now());
    expect(recovered.session(other.token)?.userId).toBe(other.user.id);
    expect(x.repo.findUserById(x.user.id)).toBeNull();
  });
  it("RH04-R3 janitor ambiguous prune failure is contained and enables recovery barrier", async () => {
    const f = fileRepo(); const x = await fixture(f.repo); const other = await independentSession(x);
    await x.remove(await x.deletion()); x.advance(7 * 24 * 60 * 60_000 + 1);
    const prune = x.repo.pruneDeletionReceipts.bind(x.repo);
    vi.spyOn(x.repo, "pruneDeletionReceipts").mockImplementationOnce((...args) => { prune(...args); throw new Error("fixture uncertain cleanup commit"); });
    expect(() => x.auth.pruneDeletionReceipts()).not.toThrow();
    expect(() => x.auth.session(other.token)).toThrow("Auth storage recovery required.");
    expect((await x.send("/auth/apple/challenge")).status).toBe(500);
  });
  it("indirect receipt read cleanup failure also marks storage unavailable", async () => {
    const revoke = vi.fn(async () => "succeeded" as const);
    const x = await fixture(new InMemoryAuthRepository(), { configured: true, revoke });
    const other = await independentSession(x);
    vi.spyOn(x.repo, "findDeletionReceipt").mockImplementationOnce(() => { throw new Error("fixture ambiguous prune during read"); });
    const result = await (await x.remove(await x.deletion())).json();
    expect(result.appleRevocation.status).toBe("failed_retryable");
    expect(revoke).not.toHaveBeenCalled();
    expect(() => x.auth.session(other.token)).toThrow("Auth storage recovery required.");
  });
  it.each([undefined, false])("D01/D02 missing/false consent never deletes", async confirmDelete => { const x = await fixture(); expect((await x.remove({ ...await x.deletion(), confirmDelete })).status).toBe(400); expect(x.repo.findUserById(x.user.id)).not.toBeNull(); });
  it("D03/D04 missing or invalid bearer is unauthorized", async () => { const x = await fixture(); const body = await x.deletion(); expect((await x.send("/auth/account", body, undefined, "DELETE")).status).toBe(401); expect((await x.remove(body, "invalid-fixture-session-token")).status).toBe(401); expect(x.repo.findUserById(x.user.id)).not.toBeNull(); });
  it.each(["login", "account_creation"])("D05/D06 rejects %s purpose", async purpose => { const x = await fixture(); const c = purpose === "login" ? x.auth.challenge() : x.auth.creationChallenge(x.tickets.issue(subject, x.repo.deletionCheckpoint()).token); expect((await x.remove({ ...x.proof(c), requestId: randomUUID(), confirmDelete: true })).status).toBe(401); expect(x.repo.findUserById(x.user.id)).not.toBeNull(); });
  it("D07 different fresh Apple subject cannot delete", async () => { const x = await fixture(); const body = await x.deletion(); expect((await x.remove({ ...body, identityToken: JSON.stringify({ subject: "another-subject", nonce: body.nonce }) })).status).toBe(401); expect(x.repo.findUserById(x.user.id)).not.toBeNull(); });
  it("D08 wrong nonce and D09 expired challenge reject", async () => { const x = await fixture(); const body = await x.deletion(); expect((await x.remove({ ...body, nonce: "wrong" })).status).toBe(401); x.advance(300_001); expect((await x.remove(body)).status).toBe(401); expect(x.repo.findUserById(x.user.id)).not.toBeNull(); });
  it("session and request ID bindings cannot be substituted", async () => { const x = await fixture(); const other = (await (await x.login()).json()).sessionToken; const body = await x.deletion(); expect((await x.remove(body, other)).status).toBe(401); expect((await x.remove({ ...body, requestId: randomUUID() })).status).toBe(401); expect(x.repo.findUserById(x.user.id)).not.toBeNull(); });
  it("D10/D11 atomic deletion invalidates every device and persists no raw credentials", async () => { const f = fileRepo(); const x = await fixture(f.repo); const other = (await (await x.login()).json()).sessionToken; const body = await x.deletion(); const response = await x.remove(body); expect(response.status).toBe(200); const result = await response.json(); expect(result).toMatchObject({ status: "account_deleted", serverAccountDeleted: true, localAutomationsDeleted: false, appleRevocation: { status: "not_configured" } }); expect(x.auth.session(x.token)).toBeNull(); expect(x.auth.session(other)).toBeNull(); expect(x.repo.findUserById(x.user.id)).toBeNull(); const raw = readFileSync(f.path, "utf8"); for (const sensitive of [subject, x.token, other, body.requestId, body.identityToken, body.nonce]) expect(raw).not.toContain(sensitive); expect(x.repo.findDeletionReceipt(result.deletionId, new Date(x.now()).toISOString())?.localDeletion).toBe("committed"); });
  it("D12 deletes all subject creation tickets", async () => { const x = await fixture(); const ticket = x.tickets.issue(subject, x.repo.deletionCheckpoint()).token; await x.remove(await x.deletion()); expect(() => x.auth.creationChallenge(ticket)).toThrow(); });
  it("D13 deletion during verifier prevents late mutation", async () => { const x = await fixture(); const body = await x.deletion(); let resolve!: (v: VerifiedAppleIdentity | null) => void; let entered!: () => void; const started = new Promise<void>(r => { entered = r; }); x.verify.mockImplementationOnce(() => { entered(); return new Promise(r => { resolve = r; }); }); const pending = x.remove(body); await started; x.auth.deleteAccountData(x.user.id); resolve(identity()); expect((await pending).status).toBe(401); expect(x.repo.findUserById(x.user.id)).toBeNull(); });
  it("D14 proven precommit failure preserves account and all sessions", async () => { const x = await fixture(); vi.spyOn(x.repo, "deleteUserAndSessions").mockImplementationOnce(() => { throw new AuthPersistenceNotCommittedError(new Error("fixture")); }); const response = await x.remove(await x.deletion()); expect(response.status).toBe(503); expect((await response.json()).status).toBe("retry_required"); expect(x.repo.findUserById(x.user.id)).not.toBeNull(); expect(x.auth.session(x.token)).not.toBeNull(); });
  it("D15 ambiguous postcommit failure is recovery_required, not rollback", async () => { const x = await fixture(); const actual = x.repo.deleteUserAndSessions.bind(x.repo); vi.spyOn(x.repo, "deleteUserAndSessions").mockImplementationOnce((...args) => { actual(...args); throw new Error("unknown commit result"); }); const response = await x.remove(await x.deletion()); expect(response.status).toBe(500); expect((await response.json()).status).toBe("recovery_required"); expect(x.repo.findUserById(x.user.id)).toBeNull(); });
  it("D16 lost response after commit keeps account deleted", async () => { const x = await fixture(); const body = await x.deletion(); const actual = x.repo.deleteUserAndSessions.bind(x.repo); vi.spyOn(x.repo, "deleteUserAndSessions").mockImplementationOnce((...args) => { const result = actual(...args); x.server.closeAllConnections(); return result; }); await expect(x.remove(body)).rejects.toThrow(); expect(x.repo.findUserById(x.user.id)).toBeNull(); expect(x.auth.session(x.token)).toBeNull(); });
  it("D17 old proof cannot delete a replacement account", async () => { const x = await fixture(); const body = await x.deletion(); await x.remove(body); const replacement = x.repo.getOrCreateUser(subject, new Date(x.now()).toISOString()); const newToken = (await (await x.login()).json()).sessionToken; expect((await x.remove(body, newToken)).status).toBe(401); expect(x.repo.findUserById(replacement.id)).not.toBeNull(); expect(replacement.id).not.toBe(x.user.id); });
  it("D18 fresh login after deletion requires explicit creation", async () => { const x = await fixture(); await x.remove(await x.deletion()); const response = await x.login(); expect(response.status).toBe(200); expect((await response.json()).status).toBe("account_creation_required"); expect(x.repo.findUserBySubject(subject)).toBeNull(); });
  it("D19 receipt survives restart; D20 expiry physically prunes stored record", async () => { const f = fileRepo(); const x = await fixture(f.repo); const result = await (await x.remove(await x.deletion())).json(); const restarted = new FileBackedAuthRepository(f.path); expect(restarted.findDeletionReceipt(result.deletionId, new Date(x.now()).toISOString())?.revocationStatus).toBe("not_configured"); expect(restarted.findDeletionReceipt(result.deletionId, new Date(x.now() + 7 * 24 * 60 * 60_000 + 1).toISOString())).toBeNull(); expect((JSON.parse(readFileSync(f.path, "utf8")) as { deletionReceipts: unknown[] }).deletionReceipts).toHaveLength(0); });
  it("D21 no credentials means not_configured and no revocation attempt", async () => { const revoke = vi.fn(async () => "succeeded" as const); const x = await fixture(new InMemoryAuthRepository(), { configured: false, revoke }); const result = await (await x.remove(await x.deletion())).json(); expect(result.appleRevocation.status).toBe("not_configured"); expect(revoke).not.toHaveBeenCalled(); });
  it("D22 mock retry transitions failed_retryable to succeeded and stops retrying", async () => { const revoke = vi.fn().mockResolvedValueOnce("failed_retryable").mockResolvedValueOnce("succeeded"); const x = await fixture(new InMemoryAuthRepository(), { configured: true, revoke }); const result = await (await x.remove(await x.deletion())).json(); expect(result.appleRevocation.status).toBe("failed_retryable"); expect(await x.auth.retryRevocation(result.deletionId)).toBe("succeeded"); expect(await x.auth.retryRevocation(result.deletionId)).toBe("succeeded"); expect(revoke).toHaveBeenCalledTimes(2); expect(x.repo.findUserById(x.user.id)).toBeNull(); });
  it("deletion endpoint preserves 64KiB and concurrency boundaries", async () => { const x = await fixture(); expect((await x.remove({ padding: "x".repeat(65_536) })).status).toBe(413); });
  it("ambiguous deletion makes stale session authentication fail closed", async () => { const x = await fixture(); vi.spyOn(x.repo, "deleteUserAndSessions").mockImplementationOnce(() => { throw new Error("uncertain native commit"); }); expect((await x.remove(await x.deletion())).status).toBe(500); expect(() => x.auth.session(x.token)).toThrow("Auth storage recovery required."); expect((await x.send("/auth/apple/challenge")).status).toBe(500); });
  it("fresh verification timeout has no deletion or late mutation", async () => { const x = await fixture(); const body = await x.deletion(); let resolve!: (v: VerifiedAppleIdentity | null) => void; x.verify.mockImplementationOnce(() => new Promise(r => { resolve = r; })); vi.useFakeTimers(); const result = x.auth.deleteAccount(x.token, body.requestId, body); await vi.advanceTimersByTimeAsync(20_000); expect(await result).toBeNull(); resolve(identity()); await vi.advanceTimersByTimeAsync(0); expect(x.repo.findUserById(x.user.id)).not.toBeNull(); });
  it("abort during verification preserves account after late verifier resolves", async () => { const x = await fixture(); const body = await x.deletion(); let resolve!: (v: VerifiedAppleIdentity | null) => void; x.verify.mockImplementationOnce(() => new Promise(r => { resolve = r; })); const abort = new AbortController(); const result = x.auth.deleteAccount(x.token, body.requestId, body, abort.signal); abort.abort(); expect(await result).toBeNull(); resolve(identity()); await new Promise(r => setImmediate(r)); expect(x.repo.findUserById(x.user.id)).not.toBeNull(); });
  it("receipt is not persisted when the atomic file candidate fails", async () => { const f = fileRepo(); const x = await fixture(f.repo); const body = await x.deletion(); const actual = f.repo.deleteUserAndSessions.bind(f.repo); vi.spyOn(f.repo, "deleteUserAndSessions").mockImplementationOnce((...args) => { vi.spyOn(f.repo as unknown as { persist(): void }, "persist").mockImplementationOnce(() => { throw new AuthPersistenceNotCommittedError(new Error("fixture file write")); }); return actual(...args); }); expect((await x.remove(body)).status).toBe(503); const data = JSON.parse(readFileSync(f.path, "utf8")); expect(data.users).toHaveLength(1); expect(data.sessions).toHaveLength(1); expect(data.deletionReceipts ?? []).toHaveLength(0); });
  it("deletion uses the existing shared auth rate limiter", async () => { const x = await fixture(new InMemoryAuthRepository(), undefined, { authRateLimit: { maxPerPeer: 3 } }); const body = await x.deletion(); const response = await x.remove(body); expect(response.status).toBe(429); expect(x.repo.findUserById(x.user.id)).not.toBeNull(); });
  it("creation remains rejected even if ticket invalidation throws after committed deletion", async () => { const x = await fixture(); const ticket = x.tickets.issue(subject, x.repo.deletionCheckpoint()).token; const c = x.auth.creationChallenge(ticket); vi.spyOn(x.tickets, "invalidateSubject").mockImplementationOnce(() => { throw new Error("fixture invalidation failure"); }); expect((await x.remove(await x.deletion())).status).toBe(500); expect(x.repo.findUserById(x.user.id)).toBeNull(); expect(() => x.auth.session(x.token)).toThrow(); expect(() => x.auth.creationChallenge(ticket)).toThrow(); await expect(x.auth.completeAccountCreation(ticket, "replay", x.proof(c))).rejects.toThrow("Auth storage recovery required."); });
  it("real HTTP DELETE disconnect releases capacity and cannot delete on late proof", async () => {
    const x = await fixture(new InMemoryAuthRepository(), undefined, { maxConcurrentAuth: 1 });
    const body = await x.deletion();
    let resolve!: (v: VerifiedAppleIdentity | null) => void;
    let entered!: () => void;
    const started = new Promise<void>(r => { entered = r; });
    x.verify.mockImplementationOnce(() => { entered(); return new Promise(r => { resolve = r; }); });
    const controller = new AbortController();
    const result = fetch(x.base + "/auth/account", { method: "DELETE", headers: { "Content-Type": "application/json", Authorization: `Bearer ${x.token}` }, body: JSON.stringify(body), signal: controller.signal }).catch(() => null);
    await started;
    expect((await x.send("/auth/apple/challenge")).status).toBe(503);
    controller.abort(); await result;
    await vi.waitFor(async () => { expect((await x.send("/auth/apple/challenge")).status).toBe(200); });
    resolve(identity()); await new Promise(r => setImmediate(r));
    expect(x.repo.findUserById(x.user.id)).not.toBeNull();
  });
  it("concurrent mock revocation retries share one bounded attempt", async () => {
    const revoke = vi.fn().mockResolvedValueOnce("failed_retryable");
    const x = await fixture(new InMemoryAuthRepository(), { configured: true, revoke });
    const result = await (await x.remove(await x.deletion())).json();
    let resolve!: (status: string) => void;
    revoke.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const a = x.auth.retryRevocation(result.deletionId);
    const b = x.auth.retryRevocation(result.deletionId);
    resolve("succeeded");
    expect(await a).toBe("succeeded"); expect(await b).toBe("succeeded");
    expect(revoke).toHaveBeenCalledTimes(2);
  });
  it("HTTP creation already verifying cannot recreate the account after committed deletion", async () => {
    const x = await fixture();
    const deletion = await x.deletion();
    const ticket = x.tickets.issue(subject, x.repo.deletionCheckpoint()).token;
    const c = x.auth.creationChallenge(ticket);
    let resolve!: (value: VerifiedAppleIdentity | null) => void;
    let entered!: () => void;
    const started = new Promise<void>(r => { entered = r; });
    x.verify.mockImplementationOnce(() => { entered(); return new Promise(r => { resolve = r; }); });
    const creation = x.send("/auth/accounts", { ...x.proof(c), creationTicket: ticket, confirmCreate: true, requestId: randomUUID() });
    await started;
    expect((await x.remove(deletion)).status).toBe(200);
    resolve(identity());
    expect((await creation).status).toBe(410);
    expect(x.repo.findUserBySubject(subject)).toBeNull();
  });
});
