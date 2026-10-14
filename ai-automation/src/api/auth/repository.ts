import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { AuthChallengePurpose, AuthRepository, AuthSession, AuthUser, CreateAccountResult, DeletionCheckpoint, LoginGuard, DeletionReceipt, RevocationStatus } from "./types.js";
import { LoginGuards } from "./login-guards.js";

interface Challenge { id: string; nonceHash: string; expiresAt: string; usedAt?: string; purpose?: AuthChallengePurpose; ticketHash?: string; accountId?: string }
interface AuthData { users: AuthUser[]; sessions: AuthSession[]; challenges: Challenge[]; deletionReceipts?: DeletionReceipt[] }

// Validate existing storage without migration, defaulting missing fields,
// stripping extensions, or rewriting bytes. Short legacy token hashes remain
// valid strings: this is a storage shape check, not a credential migration.
const storedString = z.string().min(1);
const storedPurpose = z.enum(["login", "account_creation", "account_deletion"]);
const authDataSchema = z.object({
  users: z.array(z.object({ id: storedString, appleSubject: storedString, createdAt: storedString }).passthrough()),
  sessions: z.array(z.object({
    id: storedString, userId: storedString, tokenHash: storedString,
    createdAt: storedString, expiresAt: storedString, revokedAt: storedString.optional(),
  }).passthrough()),
  challenges: z.array(z.object({
    id: storedString, nonceHash: storedString, expiresAt: storedString,
    usedAt: storedString.optional(), purpose: storedPurpose.optional(),
    ticketHash: storedString.optional(), accountId: storedString.optional(),
  }).passthrough()),
  deletionReceipts: z.array(z.object({
    deletionId: storedString, requestIdHash: storedString, subjectHash: storedString,
    accountGeneration: storedString, localDeletion: z.literal("committed"),
    revocationStatus: z.enum(["not_configured", "pending", "succeeded", "failed_retryable", "failed_permanent"]),
    createdAt: storedString, expiresAt: storedString,
  }).passthrough()).optional(),
}).passthrough();

export class AuthUserNotFoundError extends Error {
  constructor() { super("Session user does not exist."); this.name = "AuthUserNotFoundError"; }
}

export class AuthDataIntegrityError extends Error {
  constructor() { super("Auth storage integrity validation failed."); this.name = "AuthDataIntegrityError"; }
}

/** Only emitted by the file adapter before its successful rename commit boundary. */
export class AuthPersistenceNotCommittedError extends Error {
  constructor(cause: unknown) { super("Auth persistence did not commit.", { cause }); this.name = "AuthPersistenceNotCommittedError"; }
}

/** Synchronous transactions keep challenge consumption atomic on this single Node process. */
export class InMemoryAuthRepository implements AuthRepository {
  protected data: AuthData = { users: [], sessions: [], challenges: [] };
  private readonly loginGuards = new LoginGuards();
  beginLoginGuard(): LoginGuard { return this.loginGuards.begin(); }
  validateLoginGuard(guard: LoginGuard, subject: string): void { this.loginGuards.validate(guard, subject); }
  releaseLoginGuard(guard: LoginGuard): void { this.loginGuards.release(guard); }
  deletionCheckpoint(): DeletionCheckpoint { return this.loginGuards.checkpoint(); }
  validateDeletionCheckpoint(checkpoint: DeletionCheckpoint, subject: string): void { this.loginGuards.validateCheckpoint(checkpoint, subject); }
  findUserBySubject(subject: string): AuthUser | null { const user = this.data.users.find(user => user.appleSubject === subject); return user ? { ...user } : null; }
  findUserById(id: string): AuthUser | null { const user = this.data.users.find(user => user.id === id); return user ? { ...user } : null; }

  createUserWithInitialSession(appleSubject: string, input: Omit<AuthSession, "userId">): CreateAccountResult {
    if (this.data.users.some(user => user.appleSubject === appleSubject)) return { status: "account_exists" };
    const user = { id: randomUUID(), appleSubject, createdAt: input.createdAt };
    const session: AuthSession = { ...input, userId: user.id };
    const candidate = { ...this.data, users: [...this.data.users, user], sessions: [...this.data.sessions, session] };
    this.persist(candidate);
    this.data = candidate;
    return { status: "created", user: { ...user }, session: { ...session } };
  }

  /** One synchronous transaction; callers must use a single repository instance. */
  deleteUserAndSessions(userId: string, receipt?: DeletionReceipt): boolean {
    const user = this.data.users.find(user => user.id === userId);
    if (!user) return false;
    const subjectDigest = this.loginGuards.digest(user.appleSubject);
    const candidate: AuthData = {
      users: this.data.users.filter(user => user.id !== userId),
      sessions: this.data.sessions.filter(session => session.userId !== userId),
      challenges: this.data.challenges.filter(challenge => challenge.accountId !== userId).map(challenge => ({ ...challenge })),
      deletionReceipts: receipt
        ? [...(this.data.deletionReceipts ?? []).filter(item => item.expiresAt > receipt.createdAt).slice(-1023), { ...receipt }]
        : this.data.deletionReceipts,
    };
    this.persist(candidate);
    this.data = candidate;
    this.loginGuards.deleted(subjectDigest);
    return true;
  }

  pruneDeletionReceipts(now: string): void {
    const records = this.data.deletionReceipts ?? [];
    const retained = records.filter(item => item.expiresAt > now);
    if (retained.length === records.length) return;
    const candidate = { ...this.data, deletionReceipts: retained };
    this.persist(candidate); this.data = candidate;
  }

  findDeletionReceipt(id: string, now: string): DeletionReceipt | null {
    this.pruneDeletionReceipts(now);
    const receipt = this.data.deletionReceipts?.find(item => item.deletionId === id);
    return receipt ? { ...receipt } : null;
  }

  updateRevocationStatus(id: string, status: RevocationStatus, now: string): void {
    this.pruneDeletionReceipts(now);
    const candidate = { ...this.data, deletionReceipts: (this.data.deletionReceipts ?? []).map(item => item.deletionId === id ? { ...item, revocationStatus: status } : item) };
    this.persist(candidate); this.data = candidate;
  }

  createChallenge(id: string, nonceHash: string, expiresAt: string, purpose: AuthChallengePurpose = "login", ticketHash?: string, accountId?: string): void {
    if (purpose !== "login" && (!ticketHash || !/^[a-f0-9]{64}$/.test(ticketHash))) throw new Error("Challenge binding required.");
    if (purpose === "account_deletion" && !accountId) throw new Error("Deletion account binding required.");
    const now = new Date().toISOString();
    const challenges = this.data.challenges.filter((item) => item.expiresAt > now && !item.usedAt);
    challenges.push({ id, nonceHash, expiresAt, purpose, ...(purpose !== "login" ? { ticketHash } : {}), ...(purpose === "account_deletion" ? { accountId } : {}) });
    const candidate = { ...this.data, challenges };
    this.persist(candidate);
    this.data = candidate;
  }

  consumeChallenge(id: string, nonceHash: string, now: string, purpose: AuthChallengePurpose = "login", ticketHash?: string): boolean {
    const challenge = this.data.challenges.find((item) => item.id === id);
    if (!challenge || challenge.usedAt || challenge.expiresAt <= now || challenge.nonceHash !== nonceHash) return false;
    if ((challenge.purpose ?? "login") !== purpose) return false;
    if (purpose !== "login" && (!ticketHash || challenge.ticketHash !== ticketHash)) return false;
    const candidate = { ...this.data, challenges: this.data.challenges.map(item => item === challenge ? { ...item, usedAt: now } : item) };
    this.persist(candidate);
    this.data = candidate;
    return true;
  }

  getOrCreateUser(appleSubject: string, now: string): AuthUser {
    const existing = this.data.users.find((user) => user.appleSubject === appleSubject);
    if (existing) return existing;
    const user = { id: randomUUID(), appleSubject, createdAt: now };
    this.data.users.push(user);
    this.persist();
    return user;
  }

  createSession(session: AuthSession): void {
    if (!this.data.users.some(user => user.id === session.userId)) throw new AuthUserNotFoundError();
    const candidate = { ...this.data, sessions: [...this.data.sessions, { ...session }] };
    this.persist(candidate);
    this.data = candidate;
  }

  findSession(tokenHash: string, now: string): AuthSession | null {
    return this.data.sessions.find((session) => session.tokenHash === tokenHash && !session.revokedAt && session.expiresAt > now
      && this.data.users.some(user => user.id === session.userId)) ?? null;
  }

  revokeSession(tokenHash: string, now: string): boolean {
    const session = this.findSession(tokenHash, now);
    if (!session) return false;
    session.revokedAt = now;
    this.persist();
    return true;
  }

  protected persist(_candidate: AuthData = this.data): void {}
}

/** Development/P0 single-process persistence, not a production multi-instance database. */
export class FileBackedAuthRepository extends InMemoryAuthRepository {
  constructor(private readonly filePath: string) {
    super();
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
      if (!authDataSchema.safeParse(parsed).success) throw new AuthDataIntegrityError();
      const validated = parsed as AuthData;
      const subjects = validated.users.map(user => user.appleSubject);
      if (new Set(subjects).size !== subjects.length) throw new AuthDataIntegrityError();
      this.data = validated;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  protected override persist(candidate: AuthData = this.data): void {
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
      writeFileSync(temporary, JSON.stringify(candidate), { mode: 0o600, flag: "wx" });
      // Commit boundary: no fallible work follows a successful rename.
      // This does not promise power-loss durability (no file/directory fsync).
      renameSync(temporary, this.filePath);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* Preserve the original failure. */ }
      throw new AuthPersistenceNotCommittedError(error);
    }
  }
}
