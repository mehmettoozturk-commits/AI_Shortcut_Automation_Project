import { afterEach, describe, expect, it, vi } from "vitest";
import { request, type Server } from "node:http";
import { AuthService } from "../src/api/auth/service.js";
import { InMemoryAuthRepository } from "../src/api/auth/repository.js";
import { createPlanServer } from "../src/api/server.js";

const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function fixture(options: Parameters<typeof createPlanServer>[0] = {}, repo = new InMemoryAuthRepository()) {
  const verify = vi.fn(async (token: string, _aud: string, nonce: string) => {
    const value = JSON.parse(token) as { subject: string; nonce: string };
    return value.nonce === nonce ? { subject: value.subject, issuer: "https://appleid.apple.com", audience: "com.aishortcut.AutomationApp", issuedAt: 1, expiresAt: 9_999_999_999 } : null;
  });
  let now = Date.now();
  const auth = new AuthService(repo, { verify }, () => now);
  const server = createPlanServer({ ...options, auth }); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("address");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (route: string, body: unknown = {}) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const proof = (challenge: { challengeId: string; nonce: string }, subject = "fixture-subject") => ({ challengeId: challenge.challengeId, nonce: challenge.nonce, identityToken: JSON.stringify({ subject, nonce: challenge.nonce }) });
  async function login(supported = true) { const c = await (await post("/auth/apple/challenge")).json(); return post("/auth/apple", { ...proof(c), ...(supported ? { accountCreationSupported: true } : {}) }); }
  async function ticket() { return (await (await login()).json()).creationTicket as string; }
  async function creation(t: string) { const c = await (await post("/auth/accounts/challenge", { creationTicket: t })).json(); return { ...proof(c), creationTicket: t, confirmCreate: true, requestId: c.challengeId }; }
  return { repo, auth, verify, post, proof, login, ticket, creation, base, server, advance: (ms: number) => { now += ms; } };
}

describe("Explicit account creation HTTP boundary", () => {
  it("unexpected exception returns safe 500 without internal details", async () => {
    const x = await fixture();
    vi.spyOn(x.auth, "challenge").mockImplementationOnce(() => { throw new Error("fixture-secret-token /private/auth.json apple-subject"); });
    const response = await x.post("/auth/apple/challenge");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "internal_error", message: "İşlem tamamlanamadı." } });
    expect((await x.post("/auth/apple/challenge")).status).toBe(200);
  });
  it("new client receives consent ticket without account/session mutation", async () => { const x = await fixture(); const create = vi.spyOn(x.repo, "createUserWithInitialSession"); const sessions = vi.spyOn(x.repo, "createSession"); const legacy = vi.spyOn(x.auth, "signIn"); const response = await x.login(); expect(response.status).toBe(200); expect((await response.json()).status).toBe("account_creation_required"); expect(x.repo.findUserBySubject("fixture-subject")).toBeNull(); expect(create).not.toHaveBeenCalled(); expect(sessions).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled(); });
  it("legacy missing account receives 426 and cannot silently create", async () => { const x = await fixture(); const response = await x.login(false); expect(response.status).toBe(426); expect((await response.json()).status).toBe("client_update_required"); expect(x.repo.findUserBySubject("fixture-subject")).toBeNull(); });
  it("existing account preserves successful session fields for legacy client", async () => { const x = await fixture(); const user = x.repo.getOrCreateUser("fixture-subject", new Date().toISOString()); const response = await x.login(false); expect(response.status).toBe(200); const body = await response.json(); expect(body.userId).toBe(user.id); expect(x.auth.session(body.sessionToken)?.userId).toBe(user.id); });
  it.each([undefined, false])("requires explicit true consent (%s rejected)", async confirmCreate => { const x = await fixture(); const body = await x.creation(await x.ticket()); expect((await x.post("/auth/accounts", { ...body, confirmCreate })).status).toBe(400); expect(x.repo.findUserBySubject("fixture-subject")).toBeNull(); });
  it("fresh creation proof creates one account and replay cannot create another session", async () => { const x = await fixture(); const create = vi.spyOn(x.repo, "createUserWithInitialSession"); const body = await x.creation(await x.ticket()); const response = await x.post("/auth/accounts", body); expect(response.status).toBe(200); const result = await response.json(); expect(result.status).toBe("created"); expect(x.auth.session(result.sessionToken)?.userId).toBe(result.userId); expect((await x.post("/auth/accounts", body)).status).toBe(410); expect(create).toHaveBeenCalledTimes(1); });
  it("expired tickets yield identical 410 responses from challenge and create", async () => { const x = await fixture(); const t = await x.ticket(); const body = await x.creation(t); x.advance(300_001); const challenge = await x.post("/auth/accounts/challenge", { creationTicket: t }); const create = await x.post("/auth/accounts", body); expect(challenge.status).toBe(410); expect(create.status).toBe(410); expect(await challenge.json()).toEqual(await create.json()); expect(x.repo.findUserBySubject("fixture-subject")).toBeNull(); });
  it("unknown ticket receives the same safe 410 without invoking Apple verifier", async () => { const x = await fixture(); const t = await x.ticket(); const body = await x.creation(t); x.verify.mockClear(); const response = await x.post("/auth/accounts", { ...body, creationTicket: "x".repeat(43) }); expect(response.status).toBe(410); expect(await response.json()).toEqual({ error: { code: "creation_ticket_invalid_or_expired", message: "Hesap oluşturma işleminin süresi doldu. Lütfen yeniden giriş yapın." } }); expect(x.verify).not.toHaveBeenCalled(); });
  it("service restart rejects old RAM ticket but preserves existing user login", async () => { const x = await fixture(); const t = await x.ticket(); const body = await x.creation(t); const restarted = await fixture({}, x.repo); expect((await restarted.post("/auth/accounts", body)).status).toBe(410); expect((await restarted.post("/auth/accounts/challenge", { creationTicket: t })).status).toBe(410); x.repo.getOrCreateUser("fixture-subject", new Date().toISOString()); expect((await restarted.login()).status).toBe(200); });
  it("lost response after commit preserves account and recovers through fresh login", async () => {
    const x = await fixture(); const body = await x.creation(await x.ticket());
    const actual = x.repo.createUserWithInitialSession.bind(x.repo);
    const create = vi.spyOn(x.repo, "createUserWithInitialSession").mockImplementationOnce((...args) => {
      const result = actual(...args);
      x.server.closeAllConnections(); // Commit happened; response cannot reach the client.
      return result;
    });
    await expect(x.post("/auth/accounts", body)).rejects.toThrow();
    const user = x.repo.findUserBySubject("fixture-subject"); expect(user).not.toBeNull();
    expect((await x.post("/auth/accounts", body)).status).toBe(410);
    const login = await x.login(); expect(login.status).toBe(200);
    expect((await login.json()).userId).toBe(user?.id);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("wrong subject and login-purpose proof are rejected without mutation", async () => { const x = await fixture(); const t = await x.ticket(); const fresh = await x.creation(t); expect((await x.post("/auth/accounts", { ...fresh, identityToken: JSON.stringify({ subject: "other", nonce: fresh.nonce }) })).status).toBe(401); const c = await (await x.post("/auth/apple/challenge")).json(); expect((await x.post("/auth/accounts", { ...x.proof(c), creationTicket: t, confirmCreate: true, requestId: "fixture" })).status).toBe(401); expect(x.repo.findUserBySubject("fixture-subject")).toBeNull(); });
  it("two device tickets yield one created account and one account_exists", async () => { const x = await fixture(); const a = await x.creation(await x.ticket()); const b = await x.creation(await x.ticket()); const responses = await Promise.all([x.post("/auth/accounts", a), x.post("/auth/accounts", b)]); expect(responses.map(r => r.status).sort()).toEqual([200, 409]); });
  it("deleted account invalidates previously issued ticket", async () => { const x = await fixture(); const t = await x.ticket(); const u = x.repo.getOrCreateUser("fixture-subject", new Date().toISOString()); x.auth.deleteAccountData(u.id); expect((await x.post("/auth/accounts/challenge", { creationTicket: t })).status).toBe(410); expect(x.repo.findUserBySubject("fixture-subject")).toBeNull(); });
  it("new create route enforces body and proof bounds", async () => { const x = await fixture(); expect((await x.post("/auth/accounts", { padding: "x".repeat(65_536) })).status).toBe(413); const body = await x.creation(await x.ticket()); expect((await x.post("/auth/accounts", { ...body, identityToken: "x".repeat(16_385) })).status).toBe(400); });
  it("auth routes share rate limits regardless of spoofed forwarded identity", async () => { const x = await fixture({ authRateLimit: { maxPerPeer: 1 } }); expect((await x.post("/auth/apple/challenge")).status).toBe(200); const response = await fetch(x.base + "/auth/accounts/challenge", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.99" }, body: JSON.stringify({ creationTicket: "x".repeat(43) }) }); expect(response.status).toBe(429); expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0); });
  it("auth concurrency limit returns 503 without consuming creation proof", async () => { const x = await fixture({ maxConcurrentAuth: 0 }); const response = await x.post("/auth/accounts", {}); expect(response.status).toBe(503); expect(x.verify).not.toHaveBeenCalled(); });
  it("disconnect during fresh verification releases capacity and late identity cannot mutate", async () => {
    const x = await fixture({ maxConcurrentAuth: 1 });
    const body = await x.creation(await x.ticket());
    let resolve!: (value: Awaited<ReturnType<typeof x.verify>>) => void;
    let entered!: () => void;
    const started = new Promise<void>(r => { entered = r; });
    x.verify.mockImplementationOnce(() => { entered(); return new Promise(r => { resolve = r; }); });
    const controller = new AbortController();
    const request = fetch(x.base + "/auth/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal }).catch(() => null);
    await started;
    expect((await x.post("/auth/apple/challenge")).status).toBe(503);
    controller.abort(); await request;
    await vi.waitFor(async () => { expect((await x.post("/auth/apple/challenge")).status).toBe(200); });
    resolve({ subject: "fixture-subject", issuer: "https://appleid.apple.com", audience: "com.aishortcut.AutomationApp", issuedAt: 1, expiresAt: 9_999_999_999 });
    await new Promise(r => setImmediate(r));
    expect(x.repo.findUserBySubject("fixture-subject")).toBeNull();
  });
  it("slow incomplete auth body times out and releases its concurrency slot", async () => {
    const x = await fixture({ maxConcurrentAuth: 1, authRequestTimeoutMs: 100 });
    const closed = new Promise<void>(resolve => {
      const req = request(x.base + "/auth/accounts", { method: "POST", headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked" } });
      req.on("error", () => resolve());
      req.on("close", () => resolve());
      req.write('{"creationTicket":');
    });
    await closed;
    expect((await x.post("/auth/apple/challenge")).status).toBe(200);
    expect(x.verify).not.toHaveBeenCalled();
    expect(x.repo.findUserBySubject("fixture-subject")).toBeNull();
  });
});
