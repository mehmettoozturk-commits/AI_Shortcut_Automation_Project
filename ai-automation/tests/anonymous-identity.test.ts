import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { request, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnonymousIdentityService } from "../src/api/auth/anonymous-identity.js";
import { createPlanServer } from "../src/api/server.js";
import { defaultAccessResolver, snapshotRoutingAccess, type AccessResolver } from "../src/nlu/routing-access.js";
import { OpenAICompatibleIntentProvider } from "../src/nlu/providers/openai-compatible-provider.js";
import { SqliteQuotaLedger } from "../src/quota/sqlite-ledger.js";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const roots: string[] = [], services: AnonymousIdentityService[] = [], servers: Server[] = [];
const header = "X-Automation-Guest-Token";
function fixture() { const root = mkdtempSync(join(realpathSync(tmpdir()), "p3-anonymous-")); roots.push(root); return join(root, "anonymous.sqlite"); }
function open(path = fixture(), clock = Date.now) { const service = new AnonymousIdentityService(path, clock); services.push(service); return service; }
afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) { s.closeAllConnections(); await new Promise<void>(resolve => s.close(() => resolve())); }
  for (const s of services.splice(0)) s.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function http(service: AnonymousIdentityService | undefined = open(), extra: Parameters<typeof createPlanServer>[0] = {}) {
  const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ intent: "create_automation", confidence: 0.9,
    trigger: { semantic: "battery_below", details: { level: 25, condition: "above" } }, steps: [{ semantic: "notify" }], entities: [], missing: [] }) } }] });
  const provider = new OpenAICompatibleIntentProvider({ client: { chat: { completions: { create } } }, baseURL: "https://unused.invalid", model: "fixture-only", providerLabel: "Fixture" });
  const resolver = vi.fn<AccessResolver>(defaultAccessResolver);
  const server = createPlanServer({ anonymous: service, routing: { enabled: true, resolveAccess: resolver, channels: { free: {
    enabled: true, provider, configuration: { channel: "free", configurationId: "fixture-only", providerId: "groq", model: "fixture-only", keyReference: "SYNTHETIC_FREE_KEY" },
  } } }, ...extra }); servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw Error();
  const url = `http://127.0.0.1:${address.port}`;
  const post = (path: string, headers: Record<string,string> = {}, body: unknown = {}) => fetch(url + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { server, url, post, create, resolver, service };
}
const local = { text: "Pil %25 üstüne çıkınca bildir" };
describe("P3 real anonymous persistence and HTTP admission (disabled in production)", () => {
  it("issues distinct CSPRNG 32-byte credentials, stores only hashes, reopens same subject", () => {
    const path = fixture(), s = open(path), a = s.issue(), b = s.issue();
    expect(Buffer.from(a.token, "base64url").length).toBe(32); expect(a.token).not.toBe(b.token);
    const subject = s.verify(a.token); expect(subject?.subject).toMatch(/^[A-Za-z0-9_-]{32}$/); expect(Object.isFrozen(subject)).toBe(true);
    expect(s.verify(a.token)).toEqual(subject); expect(s.verify(b.token)).not.toEqual(subject); s.close();
    expect(readFileSync(path).includes(Buffer.from(a.token))).toBe(false); expect(open(path).verify(a.token)).toEqual(subject);
  });
  it("expires at exactly 30 days without renewal or deletion", () => {
    let now = 1_000_000; const s = open(fixture(), () => now), a = s.issue(), subject = s.verify(a.token);
    expect(Date.parse(a.expiresAt) - now).toBe(2592000000); now += 2592000000 - 1;
    expect(s.verify(a.token)).toEqual(subject); now++; expect(s.verify(a.token)).toBeNull(); expect(s.revoke(a.token)).toBe(false);
  });
  it("revocation persists across connections/restart and cannot be repeated", () => {
    const p = fixture(), a = open(p), b = open(p), token = a.issue().token;
    expect(b.verify(token)).not.toBeNull(); expect(a.revoke(token)).toBe(true); expect(b.verify(token)).toBeNull();
    a.close(); b.close(); expect(open(p).verify(token)).toBeNull(); expect(open(p).revoke(token)).toBe(false);
  });
  it("a separate Node process sees committed revoke", () => {
    const p = fixture(), s = open(p), token = s.issue().token;
    const source = new URL("../src/api/auth/anonymous-identity.ts", import.meta.url).href;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `import {AnonymousIdentityService} from ${JSON.stringify(source)};const s=new AnonymousIdentityService(${JSON.stringify(p)});if(!s.revoke(${JSON.stringify(token)}))process.exit(2);s.close();`], { encoding: "utf8", timeout: 10000 });
    expect(child.status).toBe(0); expect(s.verify(token)).toBeNull();
  });
  it.each(["before", "after"])("issue COMMIT %s failure returns no credential and latches", timing => {
    const s = open(), native = DatabaseSync.prototype.exec;
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function(this: import("node:sqlite").DatabaseSync, sql: string) {
      if (sql === "COMMIT" && timing === "before") throw Error("synthetic");
      const result = native.call(this, sql); if (sql === "COMMIT") throw Error("synthetic"); return result;
    });
    expect(() => s.issue()).toThrow("storage unavailable"); vi.restoreAllMocks(); expect(() => s.issue()).toThrow("storage unavailable");
  });
  it("revoke COMMIT uncertainty is not success; reopen distrusts already revoked token", () => {
    const p = fixture(), s = open(p), token = s.issue().token, native = DatabaseSync.prototype.exec;
    vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function(this: import("node:sqlite").DatabaseSync, sql: string) {
      const result = native.call(this, sql); if (sql === "COMMIT") throw Error("synthetic"); return result;
    });
    expect(() => s.revoke(token)).toThrow("storage unavailable"); vi.restoreAllMocks();
    expect(() => s.verify(token)).toThrow("storage unavailable"); expect(open(p).verify(token)).toBeNull();
  });
  it("rejects incompatible/triggered anonymous schema", () => {
    const p = fixture(); open(p).close(); const db = new DatabaseSync(p);
    db.exec("CREATE TRIGGER unexpected AFTER INSERT ON anonymous_credentials BEGIN DELETE FROM anonymous_credentials; END"); db.close();
    expect(() => open(p)).toThrow("storage unavailable");
  });
  it("quota V1 database cannot become an anonymous DB or receive extra tables", () => {
    const p = fixture(), ledger = new SqliteQuotaLedger(p, { enabled: true });
    const request = { identity: { kind: "account" as const, subject: "verified" }, operationId: "same", semanticHash: "a".repeat(64) };
    ledger.reserve(request); ledger.close(); expect(() => open(p)).toThrow("storage unavailable");
    const reopened = new SqliteQuotaLedger(p, { enabled: true });
    try { expect(reopened.reserve(request).created).toBe(false); }
    finally { reopened.close(); }
    const db = new DatabaseSync(p); expect(db.prepare("SELECT name FROM sqlite_schema WHERE sql IS NOT NULL").all()).toHaveLength(3); db.close();
  });
  it("issuance is explicit, no-store, commits before response and rejects client identity claims", async () => {
    const f = await http(); const res = await f.post("/auth/anonymous"); expect(res.status).toBe(200); expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json(); expect(f.service!.verify(body.token)).not.toBeNull(); expect(body).not.toHaveProperty("subject");
    expect((await f.post("/auth/anonymous", {}, { subject: "attacker", tier: "premium" })).status).toBe(400);
    expect((await f.post("/auth/anonymous", { Authorization: "" })).status).toBe(401);
    expect((await f.post("/auth/anonymous", { [header]: body.token })).status).toBe(401);
  });
  it("disabled endpoints are 404 and anonymous token cannot bypass unavailable service", async () => {
    const f = await http(open(), { anonymous: undefined });
    expect((await f.post("/auth/anonymous")).status).toBe(404); expect((await f.post("/auth/anonymous/revoke")).status).toBe(404);
    expect((await f.post("/plan", { [header]: open().issue().token }, local)).status).toBe(401);
  });
  it("valid anonymous identity is frozen/server-derived; body premium ignored; no token in response", async () => {
    const f = await http(), token = f.service!.issue().token, subject = f.service!.verify(token)!.subject;
    const res = await f.post("/plan", { [header]: token }, { text: "identity fixture input", userId: "forged", tier: "premium", subject: "forged" });
    expect(res.status).toBe(200); expect(f.resolver.mock.calls[0]?.[0]).toEqual({ kind: "anonymous", subject });
    expect(Object.isFrozen(f.resolver.mock.calls[0]?.[0])).toBe(true); expect(f.create).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await res.json())).not.toContain(token);
  });
  it("headerless and verified anonymous LocalFirst skip access resolver and provider", async () => {
    const f = await http(); expect((await f.post("/plan", {}, local)).status).toBe(200);
    expect((await f.post("/plan", { [header]: f.service!.issue().token }, local)).status).toBe(200);
    expect(f.resolver).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled();
  });
  it.each(["", "short", "A".repeat(43), "a".repeat(42) + "_"])("malformed/unknown anonymous credential is 401, not guest", async value => {
    const f = await http(); expect((await f.post("/plan", { [header]: value }, local)).status).toBe(401); expect(f.create).not.toHaveBeenCalled();
  });
  it("both credentials and duplicate raw guest header are 401", async () => {
    const f = await http(), token = f.service!.issue().token;
    expect((await f.post("/plan", { [header]: token, Authorization: "Bearer " + "x".repeat(43) }, local)).status).toBe(401);
    const body = JSON.stringify(local);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(f.url + "/plan", { method: "POST", headers: ["Host", "127.0.0.1", header, token, header, token, "Content-Type", "application/json", "Content-Length", String(Buffer.byteLength(body))] }, res => { res.resume(); res.once("end", () => resolve(res.statusCode!)); });
      req.once("error", reject); req.end(body);
    }); expect(status).toBe(401);
  });
  it("revoke endpoint returns no token and invalidates plan/repeated revoke", async () => {
    const f = await http(), token = f.service!.issue().token;
    expect((await f.post("/auth/anonymous/revoke", { [header]: token }, { subject: "other" })).status).toBe(400);
    const res = await f.post("/auth/anonymous/revoke", { [header]: token }); expect(res.status).toBe(200); expect(await res.json()).toEqual({ status: "revoked" });
    expect((await f.post("/plan", { [header]: token }, local)).status).toBe(401);
    expect((await f.post("/auth/anonymous/revoke", { [header]: token })).status).toBe(401);
  });
  it("expired credential fails at HTTP admission even for LocalFirst", async () => {
    let now = Date.now(); const s = open(fixture(), () => now), token = s.issue().token; now += 2592000000;
    const f = await http(s); expect((await f.post("/plan", { [header]: token }, local)).status).toBe(401);
  });
  it("storage failures are redacted 503, not token issuance or guest fallback", async () => {
    const s = open(), token = s.issue().token, f = await http(s); s.close();
    for (const [path, headers, body] of [["/auth/anonymous", {}, {}], ["/auth/anonymous/revoke", { [header]: token }, {}], ["/plan", { [header]: token }, local]] as const) {
      const res = await f.post(path, headers, body); expect(res.status).toBe(503); expect(await res.text()).not.toContain(token);
    } expect(f.create).not.toHaveBeenCalled();
  });
  it("revoke during entitlement await prevents SDK dispatch", async () => {
    const f = await http(), token = f.service!.issue().token;
    f.resolver.mockImplementation(async () => { f.service!.revoke(token); return { access: "free", basis: "guest" }; });
    expect((await f.post("/plan", { [header]: token }, { text: "identity fixture input" })).status).toBe(401); expect(f.create).not.toHaveBeenCalled();
  });
  it("untrusted plain transport stays 403 despite forwarding headers", async () => {
    const f = await http(); f.server.prependListener("request", req => Object.defineProperty(req.socket, "remoteAddress", { configurable: true, value: "10.1.2.3" }));
    expect((await f.post("/auth/anonymous", { "X-Forwarded-Proto": "https" })).status).toBe(403);
    expect((await f.post("/plan", { [header]: f.service!.issue().token, "X-Forwarded-Proto": "https" }, local)).status).toBe(403);
  });
  it("issuance uses existing rate and concurrency admission", async () => {
    const limited = await http(open(), { authRateLimit: { maxPerPeer: 1 } });
    expect((await limited.post("/auth/anonymous")).status).toBe(200); const res = await limited.post("/auth/anonymous"); expect(res.status).toBe(429); expect(res.headers.get("retry-after")).not.toBeNull();
    const busy = await http(open(), { maxConcurrentAuth: 0 }); expect((await busy.post("/auth/anonymous")).status).toBe(503);
  });
  it("routing rejects anonymous premium and malformed subject while preserving account/guest", async () => {
    const anonymous = { kind: "anonymous" as const, subject: "a".repeat(32) };
    expect(await defaultAccessResolver(anonymous, new AbortController().signal)).toEqual({ access: "free", basis: "guest" });
    expect(snapshotRoutingAccess({ access: "premium", basis: "verified_entitlement" }, anonymous).access).toBe("unavailable");
    expect(snapshotRoutingAccess({ access: "free", basis: "guest" }, { ...anonymous, subject: "invalid" }).access).toBe("unavailable");
    expect((await defaultAccessResolver({ ...anonymous, subject: "invalid" }, new AbortController().signal)).access).toBe("unavailable");
    expect(snapshotRoutingAccess({ access: "free", basis: "guest" }, { kind: "guest" }).access).toBe("free");
    expect(snapshotRoutingAccess({ access: "premium", basis: "verified_entitlement" }, { kind: "account", userId: "verified" }).access).toBe("premium");
  });
});
