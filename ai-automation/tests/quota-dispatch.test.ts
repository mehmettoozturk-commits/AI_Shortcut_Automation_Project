import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { request, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlanServer } from "../src/api/server.js";
import { AnonymousIdentityService } from "../src/api/auth/anonymous-identity.js";
import { SqliteQuotaLedger } from "../src/quota/sqlite-ledger.js";
import { RequestDispatchGuard, canonicalRequestHash, type AuthoritativeBudgetGuard } from "../src/quota/dispatch-guard.js";
import { OpenAICompatibleIntentProvider } from "../src/nlu/providers/openai-compatible-provider.js";
import { AuthService } from "../src/api/auth/service.js";
import { InMemoryAuthRepository } from "../src/api/auth/repository.js";
import type { NluProvider } from "../src/nlu/ports.js";
import { ClaudeIntentProvider } from "../src/nlu/providers/claude-provider.js";
import { GeminiIntentProvider } from "../src/nlu/providers/gemini-provider.js";
import { spawnSync } from "node:child_process";

const roots: string[] = [], servers: Server[] = [], closeables: Array<{close():void}> = [];
const guestHeader = "X-Automation-Guest-Token", operationHeader = "X-Automation-Operation-ID";
const affinity = { providerId: "groq", model: "fixture-only", configurationId: "fixture-free" };
const value = { intent: "create_automation", confidence: 0.9, trigger: { semantic: "battery_below", details: { level: 25, condition: "above" } }, steps: [{ semantic: "notify" }], entities: [], missing: [] };
const response = () => ({ choices: [{ message: { content: JSON.stringify(value) } }] });
function disk() { const r = mkdtempSync(join(realpathSync(tmpdir()), "p3-dispatch-")); roots.push(r); return r; }
function dependencies() {
  const root = disk(), ledger = new SqliteQuotaLedger(join(root, "quota.sqlite"), { enabled: true }), anonymous = new AnonymousIdentityService(join(root, "anonymous.sqlite"));
  closeables.push(ledger, anonymous);
  const authorize = vi.fn().mockResolvedValue("authorized");
  const reserve = vi.fn<AuthoritativeBudgetGuard["reserve"]>(async () => ({ authorize }));
  const budget = { reserve }; // Synthetic authority: NEVER proof of production durability/cost.
  const token = anonymous.issue().token, subject = anonymous.verify(token)!.subject;
  return { ledger, anonymous, authorize, reserve, budget, token, subject };
}
async function fixture(extra: Parameters<typeof createPlanServer>[0] = {}, alternate?: NluProvider) {
  const d = dependencies(), create = vi.fn().mockResolvedValue(response());
  const client = { maxRetries: 0, chat: { completions: { create } } };
  const provider = alternate ?? new OpenAICompatibleIntentProvider({ client, baseURL: "https://unused.invalid", model: affinity.model, providerLabel: "Fixture" });
  const server = createPlanServer({ anonymous: d.anonymous, quota: { enabled: true, ledger: d.ledger, budget: d.budget, budgetTimeoutMs: 50 },
    routing: { enabled: true, channels: { free: { enabled: true, provider, configuration: { ...affinity, providerId: "groq", channel: "free", keyReference: "SYNTHETIC_KEY" } } } }, ...extra });
  servers.push(server); await new Promise<void>((resolve,reject) => { server.once("error",reject); server.listen(0,"127.0.0.1",resolve); });
  const addr = server.address(); if (!addr || typeof addr === "string") throw Error(); const url = `http://127.0.0.1:${addr.port}`;
  const post = (operationId: string | null = randomUUID(), body: unknown = { text: "guarded fixture input" }, headers: Record<string,string> = { [guestHeader]: d.token }) => fetch(url + "/plan", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers, ...(operationId === null ? {} : { [operationHeader]: operationId }) }, body: JSON.stringify(body),
  }); return { ...d, create, client, provider, server, url, post };
}
afterEach(async () => {
  vi.restoreAllMocks(); for (const s of servers.splice(0)) { s.closeAllConnections(); await new Promise<void>(r=>s.close(()=>r())); }
  for (const c of closeables.splice(0)) c.close(); for (const r of roots.splice(0)) rmSync(r,{recursive:true,force:true});
});
describe("P3 guarded SDK boundary (synthetic budget and SDK; production remains OFF)", () => {
  it("quota OFF bootstrap and LocalFirst/legacy paths never load native SQLite", () => {
    const serverModule=new URL("../src/api/server.ts",import.meta.url).href, providerModule=new URL("../src/nlu/providers/openai-compatible-provider.ts",import.meta.url).href;
    const script=`import Module from 'node:module';const original=Module._load;Module._load=function(id,...args){if(id==='node:sqlite')throw Error('unexpected native SQLite load');return original.call(this,id,...args)};
      const {createPlanServer}=await import(${JSON.stringify(serverModule)});const {OpenAICompatibleIntentProvider}=await import(${JSON.stringify(providerModule)});
      let calls=0;const provider=new OpenAICompatibleIntentProvider({client:{chat:{completions:{create:async()=>{calls++;return ${JSON.stringify(response())}}}}},baseURL:'https://unused.invalid',model:'fixture-only',providerLabel:'Fixture'});
      const s=createPlanServer({quota:{enabled:false},routing:{enabled:true,channels:{free:{enabled:true,provider,configuration:{channel:'free',providerId:'groq',model:'fixture-only',configurationId:'fixture-free',keyReference:'SYNTHETIC_KEY'}}}}});
      await new Promise(r=>s.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+s.address().port+'/plan';
      const post=text=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})});
      const a=await post('Pil %25 üstüne çıkınca bildir');await a.text();const localCalls=calls;const b=await post('legacy fixture input');await b.text();
      s.closeAllConnections();await new Promise(r=>s.close(r));console.log(JSON.stringify({a:a.status,b:b.status,localCalls,calls}));`;
    const child=spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",script],{encoding:"utf8",timeout:10000});
    expect(child.status,child.stderr).toBe(0); expect(JSON.parse(child.stdout.trim())).toEqual({a:200,b:200,localCalls:0,calls:1});
  });
  it("LocalFirst uses no operation credential, quota or budget and emits zero SDK calls", async () => {
    const f = await fixture(), spy = vi.spyOn(f.ledger,"reserve");
    expect((await f.post(null,{text:"Pil %25 üstüne çıkınca bildir"},{})).status).toBe(200);
    expect(spy).not.toHaveBeenCalled(); expect(f.reserve).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled();
  });
  it("headerless AI is rejected rather than silently assigned an anonymous quota", async () => {
    const f = await fixture(); expect((await f.post(randomUUID(),{text:"guarded fixture input"},{})).status).toBe(401); expect(f.create).not.toHaveBeenCalled();
  });
  it.each([null,"bad","AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"])("invalid/missing operation ID rejects before SDK (%s)", async id => {
    const f = await fixture(); expect((await f.post(id)).status).toBe(400); expect(f.create).not.toHaveBeenCalled();
  });
  it("duplicate raw operation header rejects before SDK", async () => {
    const f = await fixture(), id = randomUUID(), body = JSON.stringify({text:"guarded fixture input"});
    const status = await new Promise<number>((resolve,reject)=>{
      const req = request(f.url+"/plan",{method:"POST",headers:["Host","127.0.0.1",guestHeader,f.token,operationHeader,id,operationHeader,id,"Content-Type","application/json","Content-Length",String(Buffer.byteLength(body))]},res=>{res.resume();res.once("end",()=>resolve(res.statusCode!));}); req.once("error",reject);req.end(body);
    }); expect(status).toBe(400); expect(f.create).not.toHaveBeenCalled();
  });
  it("initial dispatch crosses the actual SDK callback once; retry is state-only", async () => {
    const f = await fixture(), id = randomUUID(); expect((await f.post(id)).status).toBe(200);
    const duplicate = await f.post(id); expect(duplicate.status).toBe(409); expect((await duplicate.json()).error.state).toBe("COMPLETED");
    expect(f.create).toHaveBeenCalledTimes(1); expect(f.reserve).toHaveBeenCalledTimes(1); expect(f.authorize).toHaveBeenCalledTimes(1);
    expect(f.create.mock.calls[0]?.[0].max_tokens).toBe(2000); expect(f.create.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });
  it("same operation with a different request/context/unknown metadata is conflict", async () => {
    const f = await fixture(), id = randomUUID(); await f.post(id);
    const res = await f.post(id,{text:"guarded fixture input",newMetadata:"different"}); expect(res.status).toBe(409); expect((await res.json()).error.code).toBe("operation_conflict"); expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("canonical JSON key order is stable and context changes are bound", () => {
    expect(canonicalRequestHash({b:2,a:{y:2,x:1}})).toBe(canonicalRequestHash({a:{x:1,y:2},b:2}));
    expect(canonicalRequestHash({text:"same",conversation:{vehicle:"one"}})).not.toBe(canonicalRequestHash({text:"same",conversation:{vehicle:"two"}}));
  });
  it("fourth daily creation has zero new SDK calls", async () => {
    const f = await fixture(); for (let i=0;i<3;i++) expect((await f.post()).status).toBe(200);
    expect((await f.post()).status).toBe(429); expect(f.create).toHaveBeenCalledTimes(3);
  });
  it("parallel HTTP creations enforce three callbacks and same operation dispatches once", async () => {
    const f=await fixture(); const replies=await Promise.all(Array.from({length:8},()=>f.post()));
    expect(replies.filter(r=>r.status===200)).toHaveLength(3); expect(replies.filter(r=>r.status===429)).toHaveLength(5); expect(f.create).toHaveBeenCalledTimes(3);
    const other=await fixture(), id=randomUUID();const duplicates=await Promise.all([other.post(id),other.post(id)]);
    expect(duplicates.map(r=>r.status).sort()).toEqual([200,409]);expect(other.create).toHaveBeenCalledTimes(1);
  });
  it.each(["missing-budget","missing-ledger","unavailable","unknown-auth"])("missing/uncertain authority is SDK zero (%s)", async mode => {
    const f = await fixture(); if (mode==="unavailable") f.reserve.mockResolvedValue(null);
    if (mode==="unknown-auth") f.authorize.mockResolvedValue("unknown");
    if (mode.startsWith("missing")) {
      const g = new RequestDispatchGuard({ identity:()=>({kind:"anonymous",subject:f.subject}), operationId:randomUUID(),input:{text:"test"},
        ledger: mode==="missing-ledger" ? undefined:f.ledger, budget:mode==="missing-budget"?undefined:f.budget });
      await expect(g.invoke(affinity,false,2000,f.create)).rejects.toThrow();
    } else expect((await f.post()).status).toBe(503);
    expect(f.create).not.toHaveBeenCalled();
  });
  it("budget exception/timeout and late completion cannot trigger a callback", async () => {
    const f = await fixture(); f.reserve.mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve({authorize:f.authorize}),80)));
    expect((await f.post()).status).toBe(503); await new Promise(r=>setTimeout(r,90)); expect(f.create).not.toHaveBeenCalled();
    f.reserve.mockRejectedValue(Error("synthetic authority failure")); expect((await f.post()).status).toBe(503); expect(f.create).not.toHaveBeenCalled();
  });
  it("initial+repair share quota but require two separate budget authorizations", async () => {
    const f = await fixture(), reserve = vi.spyOn(f.ledger,"reserve"); f.create.mockResolvedValueOnce({choices:[{message:{content:"{"}}]}).mockResolvedValueOnce(response());
    expect((await f.post()).status).toBe(200); expect(f.create).toHaveBeenCalledTimes(2); expect(reserve).toHaveBeenCalledTimes(1);
    expect(f.reserve.mock.calls.map(c=>c[0].stage)).toEqual(["initial","repair"]); expect(f.authorize).toHaveBeenCalledTimes(2);
    expect(f.reserve.mock.calls[0]?.[0].operationId).toBe(f.reserve.mock.calls[1]?.[0].operationId);
  });
  it("repair budget unavailable prevents the second SDK callback", async () => {
    const f = await fixture(); f.create.mockResolvedValue({choices:[{message:{content:"{"}}]});
    f.reserve.mockResolvedValueOnce({authorize:f.authorize}).mockResolvedValueOnce(null);
    expect((await f.post()).status).toBe(503); expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("a direct bound adapter is guarded even without any diagnostic trace", async () => {
    const f = await fixture(), guard = new RequestDispatchGuard({identity:()=>({kind:"anonymous",subject:f.subject}),ledger:f.ledger,budget:f.budget,operationId:randomUUID(),input:{text:"direct"}});
    const provider = (f.provider as OpenAICompatibleIntentProvider).withDispatchGuard(guard,affinity);
    await provider.plan("direct"); expect(f.create).toHaveBeenCalledTimes(1);
    await expect(provider.plan("again")).rejects.toThrow(); expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("missing guard capability on a bound clone never reaches SDK", async () => {
    const f = await fixture(); const clone = (f.provider as OpenAICompatibleIntentProvider).withDispatchGuard(undefined as never,affinity);
    await expect(clone.plan("direct")).rejects.toThrow(); expect(f.create).not.toHaveBeenCalled();
  });
  it("only one repair capability exists and provider affinity cannot change", async () => {
    const f = await fixture(); const guard = new RequestDispatchGuard({identity:()=>({kind:"anonymous",subject:f.subject}),ledger:f.ledger,budget:f.budget,operationId:randomUUID(),input:{text:"one"}});
    await guard.invoke(affinity,false,2000,f.create); await guard.invoke(affinity,true,2000,f.create);
    await expect(guard.invoke(affinity,true,2000,f.create)).rejects.toThrow(); expect(f.create).toHaveBeenCalledTimes(2);
    const other = new RequestDispatchGuard({identity:()=>({kind:"anonymous",subject:f.subject}),ledger:f.ledger,budget:f.budget,operationId:randomUUID(),input:{text:"two"}});
    await other.invoke(affinity,false,2000,f.create); await expect(other.invoke({...affinity,model:"changed"},true,2000,f.create)).rejects.toThrow(); expect(f.create).toHaveBeenCalledTimes(3);
  });
  it("revoke during budget authorization is observed at final check", async () => {
    const f = await fixture(); f.authorize.mockImplementation(async()=>{f.anonymous.revoke(f.token); return "authorized";});
    expect((await f.post()).status).toBe(401); expect(f.create).not.toHaveBeenCalled();
  });
  it("abort during authority await prevents callback without refund/retry", async () => {
    const f=await fixture(), controller=new AbortController();
    f.reserve.mockImplementation(async()=>{controller.abort(); return {authorize:f.authorize};});
    const guard=new RequestDispatchGuard({identity:()=>({kind:"anonymous",subject:f.subject}),ledger:f.ledger,budget:f.budget,operationId:randomUUID(),input:{},signal:controller.signal});
    await expect(guard.invoke(affinity,false,2000,f.create)).rejects.toThrow(); expect(f.create).not.toHaveBeenCalled();
  });
  it("an uncertain quota commit gives zero SDK callbacks", async () => {
    const f = await fixture(); vi.spyOn(f.ledger,"authorizeDispatch").mockImplementation(()=>{throw Error("synthetic uncertain commit");});
    expect((await f.post()).status).toBe(503); expect(f.create).not.toHaveBeenCalled();
  });
  it("SDK failure stays consumed and cannot be retried as a new callback", async () => {
    const f = await fixture(), id=randomUUID(); f.create.mockRejectedValue(Error("synthetic connection lost"));
    expect((await f.post(id)).status).toBe(503); expect((await f.post(id)).status).toBe(409); expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("unverified SDK retry policy is rejected, including mutation during budget wait", async () => {
    const f=await fixture(); f.client.maxRetries=2; expect((await f.post()).status).toBe(503); expect(f.create).not.toHaveBeenCalled();
    f.client.maxRetries=0; f.authorize.mockImplementation(async()=>{f.client.maxRetries=2;return "authorized";});
    expect((await f.post()).status).toBe(503); expect(f.create).not.toHaveBeenCalled();
  });
  it.each(["unknown","claude","gemini"])("quota mode never invokes unguardable adapter (%s)", async kind => {
    const sdk=vi.fn(); const provider: NluProvider = kind==="claude" ? new ClaudeIntentProvider({client:{messages:{parse:sdk}}}) : kind==="gemini" ? new GeminiIntentProvider({client:{models:{generateContent:sdk}}}) : {plan:sdk};
    const f=await fixture({},provider); expect((await f.post()).status).toBe(503); expect(sdk).not.toHaveBeenCalled();
  });
  it("quota ON/router OFF cannot fall back to an arbitrary legacy AI pipeline", async () => {
    const f=await fixture({routing:{enabled:false}}); expect((await f.post()).status).toBe(503); expect(f.create).not.toHaveBeenCalled();
    expect((await f.post(null,{text:"Pil %25 üstüne çıkınca bildir"},{})).status).toBe(200);
  });
  it("quota OFF preserves legacy adapter behaviour without credentials or budget", async () => {
    const f=await fixture({quota:{enabled:false}}); expect((await f.post(null,{text:"legacy fixture input"},{})).status).toBe(200); expect(f.create).toHaveBeenCalledTimes(1); expect(f.reserve).not.toHaveBeenCalled();
  });
  it("verified account subjects use their own durable quota identity", async () => {
    const d=dependencies(), repo=new InMemoryAuthRepository(), token="s".repeat(43), now=new Date().toISOString();
    const user=repo.getOrCreateUser("synthetic-apple",now); repo.createSession({id:"one",userId:user.id,tokenHash:createHash("sha256").update(token).digest("hex"),createdAt:now,expiresAt:"2099-01-01T00:00:00Z"});
    const f=await fixture({auth:new AuthService(repo,{verify:async()=>null}), quota:{enabled:true,ledger:d.ledger,budget:d.budget},routing:{enabled:true,resolveAccess:async()=>({access:"free",basis:"no_premium"}),channels:{free:{enabled:true,provider:new OpenAICompatibleIntentProvider({client:{maxRetries:0,chat:{completions:{create:vi.fn().mockResolvedValue(response())}}},baseURL:"https://unused.invalid",model:affinity.model,providerLabel:"Fixture"}),configuration:{...affinity,providerId:"groq",channel:"free",keyReference:"SYNTHETIC_KEY"}}}}});
    expect((await f.post(randomUUID(),{text:"account fixture input"},{Authorization:`Bearer ${token}`})).status).toBe(200);
    expect(d.reserve.mock.calls[0]?.[0].identity).toEqual({kind:"account",subject:user.id});
  });
});
