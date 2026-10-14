import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AuthChallengePurpose, AuthRepository, AuthSession, AuthUser, CreateAccountResult, LoginGuard } from "./types.js";
import { LoginGuards } from "./login-guards.js";

interface Challenge { id: string; nonceHash: string; expiresAt: string; usedAt?: string; purpose?: AuthChallengePurpose; ticketHash?: string }
interface AuthData { users: AuthUser[]; sessions: AuthSession[]; challenges: Challenge[] }

export class AuthUserNotFoundError extends Error {
  constructor() { super("Session user does not exist."); this.name = "AuthUserNotFoundError"; }
}

export class AuthDataIntegrityError extends Error {
  constructor() { super("Auth account identity is not unique."); this.name = "AuthDataIntegrityError"; }
}

/** Synchronous transactions keep challenge consumption atomic on this single Node process. */
export class InMemoryAuthRepository implements AuthRepository {
  protected data: AuthData = { users: [], sessions: [], challenges: [] };
  private readonly loginGuards = new LoginGuards();
  beginLoginGuard(): LoginGuard { return this.loginGuards.begin(); }
  validateLoginGuard(guard: LoginGuard, subject: string): void { this.loginGuards.validate(guard, subject); }
  releaseLoginGuard(guard: LoginGuard): void { this.loginGuards.release(guard); }

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
  deleteUserAndSessions(userId: string): boolean {
    const user = this.data.users.find(user => user.id === userId);
    if (!user) return false;
    const subjectDigest = this.loginGuards.digest(user.appleSubject);
    const candidate: AuthData = {
      users: this.data.users.filter(user => user.id !== userId),
      sessions: this.data.sessions.filter(session => session.userId !== userId),
      challenges: this.data.challenges.map(challenge => ({ ...challenge })),
    };
    this.persist(candidate);
    this.data = candidate;
    this.loginGuards.deleted(subjectDigest);
    return true;
  }

  createChallenge(id: string, nonceHash: string, expiresAt: string, purpose: AuthChallengePurpose = "login", ticketHash?: string): void {
    if (purpose === "account_creation" && (!ticketHash || !/^[a-f0-9]{64}$/.test(ticketHash))) throw new Error("Creation challenge binding required.");
    const now = new Date().toISOString();
    this.data.challenges = this.data.challenges.filter((item) => item.expiresAt > now && !item.usedAt);
    this.data.challenges.push({ id, nonceHash, expiresAt, purpose, ...(purpose === "account_creation" ? { ticketHash } : {}) });
    this.persist();
  }

  consumeChallenge(id: string, nonceHash: string, now: string, purpose: AuthChallengePurpose = "login", ticketHash?: string): boolean {
    const challenge = this.data.challenges.find((item) => item.id === id);
    if (!challenge || challenge.usedAt || challenge.expiresAt <= now || challenge.nonceHash !== nonceHash) return false;
    if ((challenge.purpose ?? "login") !== purpose) return false;
    if (purpose === "account_creation" && (!ticketHash || challenge.ticketHash !== ticketHash)) return false;
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
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as AuthData;
      if (Array.isArray(parsed.users) && Array.isArray(parsed.sessions) && Array.isArray(parsed.challenges)) {
        const subjects = parsed.users.map(user => user.appleSubject);
        if (new Set(subjects).size !== subjects.length) throw new AuthDataIntegrityError();
        this.data = parsed;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  protected override persist(candidate: AuthData = this.data): void {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(candidate), { mode: 0o600, flag: "wx" });
      // Commit boundary: no fallible work follows a successful rename.
      // This does not promise power-loss durability (no file/directory fsync).
      renameSync(temporary, this.filePath);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  }
}
