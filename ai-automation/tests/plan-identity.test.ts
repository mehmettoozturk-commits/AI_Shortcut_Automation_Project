import { createHash } from "node:crypto";
import { request, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlanServer } from "../src/api/server.js";
import { AuthService } from "../src/api/auth/service.js";
import { InMemoryAuthRepository } from "../src/api/auth/repository.js";
import { OpenAICompatibleIntentProvider } from "../src/nlu/providers/openai-compatible-provider.js";
import type { AccessResolver } from "../src/nlu/routing-access.js";

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const token = "a".repeat(43), secondToken = "b".repeat(43);
const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
} vi.restoreAllMocks(); });
async function fixture(noAuth = false, router = true) {
  const repo = new InMemoryAuthRepository();
  const makeUser = (subject: string, bearer: string) => {
    const user = repo.getOrCreateUser(subject, new Date().toISOString());
    repo.createSession({ id: subject, userId: user.id, tokenHash: hash(bearer), createdAt: new Date().toISOString(), expiresAt: "2099-01-01T00:00:00.000Z" });
    return user;
  };
  const user = makeUser("synthetic-a", token), second = makeUser("synthetic-b", secondToken);
  const auth = new AuthService(repo, { verify: async () => { throw Error("No real Apple verification"); } });
  const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
    intent: "create_automation", confidence: 0.9, trigger: { semantic: "battery_below", details: { level: 25, condition: "above" } },
    steps: [{ semantic: "notify" }], entities: [], missing: [],
  }) } }] });
  const provider = new OpenAICompatibleIntentProvider({ client: { chat: { completions: { create } } },
    baseURL: "https://unused.invalid", model: "fixture-only", providerLabel: "Fixture" });
  const resolveAccess = vi.fn<AccessResolver>(async subject => {
    await Promise.resolve();
    return subject.kind === "guest" ? { access: "free", basis: "guest" } : { access: "free", basis: "no_premium" };
  });
  const server = createPlanServer({ auth: noAuth ? undefined : auth, routing: { enabled: router, resolveAccess, channels: {
    free: { enabled: true, provider, configuration: { channel: "free", configurationId: "synthetic-free",
      providerId: "groq", model: "fixture-only", keyReference: "SYNTHETIC_FREE_KEY" } },
  } } });
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw Error("fixture address");
  const url = `http://127.0.0.1:${address.port}`;
  const post = (authorization?: string, body: unknown = { text: "identity fixture input" }) => fetch(url + "/plan", {
    method: "POST", headers: { "Content-Type": "application/json", ...(authorization !== undefined ? { Authorization: authorization } : {}) }, body: JSON.stringify(body),
  });
  return { repo, auth, create, resolveAccess, user, second, server, url, post };
}

describe("P3 verified plan account identity (no quota/provider activation)", () => {
  it("headerless LocalFirst and clarification need neither account nor entitlement resolution", async () => {
    const f = await fixture(true);
    expect((await f.post(undefined, { text: "Pil %25 üstüne çıkınca bildir" })).status).toBe(200);
    const res = await f.post(undefined, { text: "Pil azalınca bana haber ver" }); expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("needs_clarification");
    expect(f.resolveAccess).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled();
  });
  it("an actual active AuthService bearer resolves a frozen server account, not body claims", async () => {
    const f = await fixture();
    const res = await f.post(`Bearer ${token}`, { text: "identity fixture input", userId: f.second.id, tier: "premium", premium: true });
    expect(res.status).toBe(200); expect(f.resolveAccess.mock.calls[0]![0]).toEqual({ kind: "account", userId: f.user.id });
    expect(Object.isFrozen(f.resolveAccess.mock.calls[0]![0])).toBe(true); expect(f.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await res.json())).not.toContain(token);
  });
  it("no bearer plus forged account/premium claims stays guest", async () => {
    const f = await fixture(); const res = await f.post(undefined, { text: "identity fixture input", userId: f.user.id, tier: "premium", premium: true });
    expect(res.status).toBe(200); expect(f.resolveAccess.mock.calls[0]![0]).toEqual({ kind: "guest" });
  });
  it.each(["", "Basic abc", "Bearer short", "bearer " + token, "Bearer " + token + ", Bearer " + secondToken])("malformed present credential (%s) is 401, never guest", async header => {
    const f = await fixture(); const res = await f.post(header); expect(res.status).toBe(401);
    expect(f.resolveAccess).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled();
    expect(JSON.stringify(await res.json())).not.toContain(token);
  });
  it.each(["revoked", "expired", "unknown"])("%s credential is 401 even for a local template", async mode => {
    const f = await fixture(); let credential = token;
    if (mode === "revoked") f.repo.revokeSession(hash(token), new Date().toISOString());
    if (mode === "expired") {
      credential = "e".repeat(43); f.repo.createSession({ id: "expired", userId: f.user.id, tokenHash: hash(credential), createdAt: "2000-01-01", expiresAt: "2000-01-02" });
    }
    if (mode === "unknown") credential = "u".repeat(43);
    expect((await f.post(`Bearer ${credential}`, { text: "Pil yüzde25 üstüne çıkınca bildir" })).status).toBe(401);
    expect(f.create).not.toHaveBeenCalled(); expect(f.resolveAccess).not.toHaveBeenCalled();
  });
  it("valid-shaped bearer cannot become guest when auth is absent or router is OFF", async () => {
    for (const noAuth of [true, false]) {
      const f = await fixture(noAuth, false);
      expect((await f.post(`Bearer ${"u".repeat(43)}`)).status).toBe(401); expect(f.create).not.toHaveBeenCalled();
    }
  });
  it("duplicate Authorization headers cannot exploit Node's first-value behavior", async () => {
    const f = await fixture();
    const received = vi.fn(); f.server.prependListener("request", received);
    const body = JSON.stringify({ text: "identity fixture input" });
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(f.url + "/plan", { method: "POST", headers: ["Host", new URL(f.url).host,
        "Content-Type", "application/json", "Content-Length", String(Buffer.byteLength(body)),
        "Authorization", `Bearer ${token}`, "Authorization", `Bearer ${secondToken}`] }, res => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
      req.on("error", reject); req.end(body);
    });
    expect(received).toHaveBeenCalledTimes(1);
    expect(status).toBe(401); expect(f.resolveAccess).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled();
  });
  it("untrusted plaintext peer stays403 despite spoofed forwarding headers", async () => {
    const f = await fixture();
    // Test-only transport boundary seam, not evidence of an actual Render peer address.
    f.server.prependListener("request", req => Object.defineProperty(req.socket, "remoteAddress", { value: "10.20.30.40", configurable: true }));
    const res = await fetch(f.url + "/plan", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`,
      "X-Forwarded-Proto": "https", "X-Forwarded-For": "127.0.0.1" }, body: JSON.stringify({ text: "identity fixture input" }) });
    expect(res.status).toBe(403); expect(f.create).not.toHaveBeenCalled(); expect(f.resolveAccess).not.toHaveBeenCalled();
  });
  it("auth storage failure returns redacted503, not a guest or successful plan", async () => {
    const f = await fixture(); vi.spyOn(f.auth, "session").mockImplementation(() => { throw Error("private diagnostic " + token); });
    const res = await f.post(`Bearer ${token}`); expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain(token); expect(f.create).not.toHaveBeenCalled(); expect(f.resolveAccess).not.toHaveBeenCalled();
  });
  it("revocation between initial identity gate and validated body blocks dispatch", async () => {
    const f = await fixture(); const original = f.auth.session.bind(f.auth); let reads = 0;
    vi.spyOn(f.auth, "session").mockImplementation(value => {
      if (++reads === 2) f.repo.revokeSession(hash(value), new Date().toISOString());
      return original(value);
    });
    expect((await f.post(`Bearer ${token}`)).status).toBe(401);
    expect(f.create).not.toHaveBeenCalled(); expect(f.resolveAccess).not.toHaveBeenCalled();
  });
  it("revocation while entitlement resolver awaits is rechecked before provider call", async () => {
    const f = await fixture(); f.resolveAccess.mockImplementation(async () => {
      await Promise.resolve(); f.repo.revokeSession(hash(token), new Date().toISOString());
      return { access: "free", basis: "no_premium" };
    });
    expect((await f.post(`Bearer ${token}`)).status).toBe(401); expect(f.create).not.toHaveBeenCalled();
  });
  it("storage failure during resolver work is503 and never dispatches", async () => {
    const f = await fixture(); f.resolveAccess.mockImplementation(async () => {
      vi.spyOn(f.auth, "session").mockImplementation(() => { throw Error("synthetic private storage diagnostic"); });
      return { access: "free", basis: "no_premium" };
    });
    expect((await f.post(`Bearer ${token}`)).status).toBe(503); expect(f.create).not.toHaveBeenCalled();
  });
  it("repair cannot dispatch after the initial provider attempt revokes the session", async () => {
    const f = await fixture(); f.create.mockImplementationOnce(async () => {
      f.repo.revokeSession(hash(token), new Date().toISOString());
      return { choices: [{ message: { content: JSON.stringify({ invalid: true }) } }] };
    });
    expect((await f.post(`Bearer ${token}`)).status).toBe(401); expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("parallel accounts keep verified identities independent", async () => {
    const f = await fixture(); const res = await Promise.all([f.post(`Bearer ${token}`), f.post(`Bearer ${secondToken}`)]);
    expect(res.every(r => r.status === 200)).toBe(true);
    expect(f.resolveAccess.mock.calls.map(c => c[0]).sort((a, b) => ("userId" in a ? a.userId : "").localeCompare("userId" in b ? b.userId : "")))
      .toEqual([{ kind: "account", userId: f.user.id }, { kind: "account", userId: f.second.id }].sort((a, b) => a.userId.localeCompare(b.userId)));
  });
});
