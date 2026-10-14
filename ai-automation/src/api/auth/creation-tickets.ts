import { createHash, createHmac, randomBytes } from "node:crypto";

type Ticket = { subjectDigest: string; expiresAt: number; state: "valid" | "reserved" | "recovery_required"; operationId?: string };
export class CreationTicketRejectedError extends Error {
  constructor() { super("Creation ticket rejected."); this.name = "CreationTicketRejectedError"; }
}

/** RAM-only, single-process. Callers must pass a freshly verified subject to reserve. */
export class CreationTicketStore {
  private readonly key = randomBytes(32);
  private readonly tickets = new Map<string, Ticket>();
  constructor(private readonly now: () => number = Date.now) {}

  issue(verifiedSubject: string): { token: string; expiresAt: number } {
    this.prune();
    if (!verifiedSubject || this.tickets.size >= 1024) throw new CreationTicketRejectedError();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + 300_000;
    this.tickets.set(this.hash(token), { subjectDigest: this.subject(verifiedSubject), expiresAt, state: "valid" });
    return { token, expiresAt };
  }

  reserve(token: string, verifiedSubject: string, operationId: string): void {
    const ticket = this.lookup(token);
    if (!operationId || operationId.length > 128 || ticket.state !== "valid" || ticket.subjectDigest !== this.subject(verifiedSubject)) throw new CreationTicketRejectedError();
    ticket.state = "reserved";
    ticket.operationId = operationId;
  }

  consume(token: string, operationId: string): void {
    this.reservation(token, operationId);
    // Absence is terminal: replay cannot distinguish consumed from unknown/expired.
    this.tickets.delete(this.hash(token));
  }

  releaseConfirmedFailure(token: string, operationId: string): void {
    const ticket = this.reservation(token, operationId);
    ticket.state = "valid";
    delete ticket.operationId;
  }

  requireRecovery(token: string, operationId: string): void {
    const ticket = this.reservation(token, operationId);
    ticket.state = "recovery_required";
  }

  private reservation(token: string, operationId: string): Ticket {
    const ticket = this.lookup(token);
    if (ticket.state !== "reserved" || ticket.operationId !== operationId) throw new CreationTicketRejectedError();
    return ticket;
  }
  private lookup(token: string): Ticket {
    this.prune();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new CreationTicketRejectedError();
    const ticket = this.tickets.get(this.hash(token));
    if (!ticket) throw new CreationTicketRejectedError();
    return ticket;
  }
  private prune(): void { for (const [hash, ticket] of this.tickets) if (this.now() >= ticket.expiresAt) this.tickets.delete(hash); }
  private hash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
  private subject(subject: string): string { return createHmac("sha256", this.key).update(subject).digest("hex"); }
}
