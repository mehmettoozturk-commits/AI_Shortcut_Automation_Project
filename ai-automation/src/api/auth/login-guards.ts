import { createHmac, randomBytes } from "node:crypto";
import type { LoginGuard } from "./types.js";

export class LoginGuardRejectedError extends Error {
  constructor() { super("Login guard rejected."); this.name = "LoginGuardRejectedError"; }
}

/** Process-local only. Digests are pseudonymous identifiers, never persisted. */
export class LoginGuards {
  private readonly key = randomBytes(32);
  private generation = 0;
  private lostThrough = 0;
  private readonly active = new Set<LoginGuard>();
  private events: Array<{ generation: number; subjectDigest: string }> = [];
  constructor(private readonly now: () => number = Date.now) {}

  begin(): LoginGuard {
    if (this.active.size >= 64) throw new LoginGuardRejectedError();
    const guard = Object.freeze({ generation: this.generation, expiresAt: this.now() + 20_000 });
    this.active.add(guard);
    return guard;
  }

  validate(guard: LoginGuard, subject: string): void {
    if (!this.active.has(guard) || this.now() >= guard.expiresAt || guard.generation < this.lostThrough
      || this.events.some(event => event.generation > guard.generation && event.subjectDigest === this.digest(subject))) {
      throw new LoginGuardRejectedError();
    }
  }

  release(guard: LoginGuard): void { this.active.delete(guard); }
  digest(subject: string): string { return createHmac("sha256", this.key).update(subject).digest("hex"); }
  deleted(subjectDigest: string): void {
    this.events.push({ generation: ++this.generation, subjectDigest });
    if (this.events.length > 1024) this.lostThrough = this.events.shift()!.generation;
  }
}
