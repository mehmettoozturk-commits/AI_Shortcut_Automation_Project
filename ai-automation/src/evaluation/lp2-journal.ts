import * as fs from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { label, natural, priceOf, sum, validUsage } from "./lp2-types.js";
import type { LP2Call, LP2Limits, LP2Price, LP2Reservation } from "./lp2-types.js";

type Event = { kind: "header"; version: 1; limits: LP2Limits; price: LP2Price }
  | { kind: "reserve"; reservation: LP2Reservation }
  | { kind: "dispatch"; id: string }
  | { kind: "settle"; id: string; usage: unknown; repairNeeded: boolean }
  | { kind: "unknown"; id: string }
  | { kind: "stop" };
type Row = { sequence: number; previous: string; event: Event; hash: string };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Test fault seam: called before disk operations; has no network/SDK connection. */
export type LP2Fault = (operation: "write" | "fsync" | "directory_fsync", kind: Event["kind"] | "lock") => void;

/** Single-owner local journal. STOP is irreversible; recovery never refunds/resends. */
export class LP2Journal {
  private fd = -1;
  private lockFd = -1;
  private closed = false;
  private stopped = false;
  private ioFailed = false;
  private sequence = 0;
  private previous = "genesis";
  private calls = new Map<string, LP2Call>();
  private readonly limits: LP2Limits;
  readonly price: Readonly<LP2Price>;
  private readonly lockPath: string;
  constructor(private readonly directory: string, limits: LP2Limits, price: LP2Price, private readonly fault?: LP2Fault) {
    for (const n of [limits.calls, limits.tokens, limits.microUsd, price.input, price.output]) natural(n);
    label(price.configurationId); label(price.modelId);
    this.limits = Object.freeze({ calls: limits.calls, tokens: limits.tokens, microUsd: limits.microUsd });
    this.price = Object.freeze({ configurationId: price.configurationId, modelId: price.modelId, input: price.input, output: price.output });
    // Caller supplies an already-created, private directory. No recursive creation or path guessing.
    if (!fs.lstatSync(directory).isDirectory()) throw new Error("private_directory_required");
    this.lockPath = join(directory, "lp2.lock");
    this.lockFd = fs.openSync(this.lockPath, "wx", 0o600);
    try {
      this.fault?.("fsync", "lock"); fs.fsyncSync(this.lockFd); this.syncDirectory("lock");
      const path = join(directory, "lp2.jsonl");
      let created = false;
      try { this.fd = fs.openSync(path, "ax+", 0o600); created = true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (!fs.lstatSync(path).isFile() || fs.lstatSync(path).isSymbolicLink()) throw new Error("invalid_journal_file");
        this.fd = fs.openSync(path, "a+");
      }
      const contents = fs.readFileSync(this.fd, "utf8");
      if (created) {
        this.append({ kind: "header", version: 1, limits: this.limits, price: this.price });
        this.syncDirectory("header");
      } else this.replay(contents);
      if ([...this.calls.values()].some(c => c.state !== "settled")) {
        this.stopped = true; // Existing reservations stay charged, no automatic resend.
      }
    } catch (error) {
      this.stopped = true;
      if (this.fd >= 0) fs.closeSync(this.fd);
      fs.closeSync(this.lockFd);
      // Retain lock on uncertain initialization; operator inspection is required.
      throw error;
    }
  }
  private syncDirectory(kind: Event["kind"] | "lock"): void {
    const fd = fs.openSync(this.directory, "r");
    try { this.fault?.("directory_fsync", kind); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  private append(event: Event): void {
    const body = { sequence: this.sequence, previous: this.previous, event };
    const row: Row = { ...body, hash: digest(body) };
    try {
      this.fault?.("write", event.kind);
      const bytes = Buffer.from(JSON.stringify(row) + "\n");
      let written = 0;
      while (written < bytes.length) {
        const count = fs.writeSync(this.fd, bytes, written, bytes.length - written);
        if (count === 0) throw new Error("short_write");
        written += count;
      }
      this.fault?.("fsync", event.kind); fs.fsyncSync(this.fd);
      this.sequence++; this.previous = row.hash;
    } catch (error) { this.stopped = true; this.ioFailed = true; throw error; }
  }
  private replay(contents: string): void {
    if (!contents || !contents.endsWith("\n")) throw new Error("truncated_journal");
    const rows = contents.slice(0, -1).split("\n");
    for (const line of rows) {
      const row = JSON.parse(line) as Row;
      const body = { sequence: row.sequence, previous: row.previous, event: row.event };
      if (row.sequence !== this.sequence || row.previous !== this.previous || row.hash !== digest(body)) throw new Error("corrupt_journal");
      if (this.sequence === 0) {
        if (row.event.kind !== "header" || row.event.version !== 1 || JSON.stringify(row.event.limits) !== JSON.stringify(this.limits)
          || JSON.stringify(row.event.price) !== JSON.stringify(this.price)) throw new Error("journal_configuration_mismatch");
      } else this.apply(row.event);
      this.sequence++; this.previous = row.hash;
    }
  }
  private active(): void { if (this.closed || this.stopped) throw new Error("pilot_stopped"); }
  private validateReservation(r: LP2Reservation): void {
    for (const s of [r.id, r.runId, r.configurationId]) label(s);
    for (const n of [r.input, r.output, r.microUsd]) natural(n);
    if (r.attempt !== 0 && r.attempt !== 1) throw new Error("invalid_attempt");
    if (this.calls.has(r.id) || r.configurationId !== this.price.configurationId) throw new Error("duplicate_or_wrong_configuration");
    if ([...this.calls.values()].some(c => c.state !== "settled")) throw new Error("concurrency_limit");
    const previous = [...this.calls.values()].filter(c => c.reservation.runId === r.runId);
    if (r.attempt === 0 ? previous.length !== 0 : previous.length !== 1 || previous[0]!.state !== "settled" || !previous[0]!.repairNeeded) throw new Error("invalid_repair");
    if (r.microUsd !== priceOf(r.input, r.output, this.price)) throw new Error("reservation_price_mismatch");
    const totals = this.totals();
    if (sum(totals.calls, 1) > this.limits.calls || sum(totals.tokens, r.input, r.output) > this.limits.tokens
      || sum(totals.microUsd, r.microUsd) > this.limits.microUsd) throw new Error("budget_exhausted");
  }
  private apply(event: Event): void {
    if (this.stopped) throw new Error("event_after_stop");
    if (event.kind === "reserve") {
      this.validateReservation(event.reservation);
      this.calls.set(event.reservation.id, { reservation: { ...event.reservation }, state: "reserved" }); return;
    }
    if (event.kind === "stop") { this.stopped = true; return; }
    if (event.kind === "header") throw new Error("duplicate_header");
    const call = this.calls.get(event.id);
    if (!call) throw new Error("unknown_call");
    if (event.kind === "dispatch") {
      if (call.state !== "reserved") throw new Error("duplicate_dispatch"); call.state = "dispatching";
    } else if (event.kind === "unknown") {
      if (call.state !== "reserved" && call.state !== "dispatching") throw new Error("invalid_unknown");
      call.state = "unknown"; this.stopped = true;
    } else {
      if (call.state !== "dispatching" || typeof event.repairNeeded !== "boolean") throw new Error("invalid_settlement");
      if (!validUsage(event.usage)) { call.state = "unknown"; this.stopped = true; return; }
      const actual = priceOf(event.usage.input, event.usage.output, this.price);
      call.usage = { ...event.usage }; call.actualMicroUsd = actual; call.state = "settled"; call.repairNeeded = event.repairNeeded;
      const r = call.reservation;
      if (event.usage.input > r.input || event.usage.output > r.output || actual > r.microUsd) this.stopped = true;
    }
  }
  reserve(reservation: LP2Reservation): void {
    this.active();
    const r: LP2Reservation = { id: reservation.id, runId: reservation.runId, attempt: reservation.attempt,
      configurationId: reservation.configurationId, input: reservation.input, output: reservation.output, microUsd: reservation.microUsd };
    try { this.validateReservation(r); } catch (error) {
      if (error instanceof Error && error.message === "budget_exhausted") this.stop();
      throw error;
    }
    this.append({ kind: "reserve", reservation: r }); this.apply({ kind: "reserve", reservation: r });
  }
  dispatch(id: string): void {
    this.active(); if (this.calls.get(id)?.state !== "reserved") throw new Error("duplicate_dispatch");
    this.append({ kind: "dispatch", id }); this.apply({ kind: "dispatch", id });
  }
  settle(id: string, usage: unknown, repairNeeded = false): void {
    this.active(); if (this.calls.get(id)?.state !== "dispatching") throw new Error("invalid_settlement");
    // Persist only validated counters, never arbitrary provider payloads, prompt or errors.
    const safeUsage = validUsage(usage) ? { input: usage.input, output: usage.output, reasoning: usage.reasoning,
      total: usage.total, reasoningIncludedInOutput: true as const } : null;
    const event: Event = { kind: "settle", id, usage: safeUsage, repairNeeded };
    this.append(event);
    try { this.apply(event); } catch (error) { this.stopped = true; throw error; }
  }
  unknown(id: string): void {
    this.active();
    const state = this.calls.get(id)?.state;
    if (state !== "reserved" && state !== "dispatching") throw new Error("invalid_unknown");
    const event: Event = { kind: "unknown", id };
    this.append(event); this.apply(event);
  }
  stop(): void { this.active(); this.append({ kind: "stop" }); this.stopped = true; }
  get isStopped(): boolean { return this.stopped || this.closed; }
  snapshot(): LP2Call[] { return structuredClone([...this.calls.values()]); }
  totals(): LP2Limits {
    return [...this.calls.values()].reduce((t, c) => ({ calls: sum(t.calls, 1),
      tokens: sum(t.tokens, c.usage?.total ?? sum(c.reservation.input, c.reservation.output)),
      microUsd: sum(t.microUsd, c.actualMicroUsd ?? c.reservation.microUsd) }), { calls: 0, tokens: 0, microUsd: 0 });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; fs.closeSync(this.fd); fs.closeSync(this.lockFd);
    // Only this instance's successfully acquired lock; stale locks never auto-recovered.
    if (!this.ioFailed) { fs.unlinkSync(this.lockPath); this.syncDirectory("lock"); }
  }
}
