import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AppleIdentityVerifier, AuthChallengePurpose, AuthRepository, VerifiedAppleIdentity } from "./types.js";
import { LoginGuardRejectedError } from "./login-guards.js";
import { CreationTicketRejectedError, CreationTicketStore } from "./creation-tickets.js";
import { AuthPersistenceNotCommittedError } from "./repository.js";

const AUDIENCE = "com.aishortcut.AutomationApp";
const CHALLENGE_LIFETIME_MS = 5 * 60_000;
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60_000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export interface AppleProof { identityToken: string; challengeId: string; nonce: string }
export type AccountPreparation =
  | { status: "signed_in"; userId: string; sessionToken: string; expiresAt: string }
  | { status: "account_creation_required"; creationTicket: string; expiresAt: string };
export type AccountCompletion =
  | { status: "created"; userId: string; sessionToken: string; expiresAt: string }
  | { status: "account_exists" | "retry_required" | "recovery_required" };

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly verifier: AppleIdentityVerifier,
    private readonly now: () => number = Date.now,
    private readonly tickets = new CreationTicketStore(now)
  ) {}

  challenge() {
    const challengeId = randomUUID();
    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now() + CHALLENGE_LIFETIME_MS).toISOString();
    this.repository.createChallenge(challengeId, hash(nonce), expiresAt);
    return { challengeId, nonce, expiresAt };
  }

  async prepareAccountCreation(proof: AppleProof, signal?: AbortSignal): Promise<AccountPreparation | null> {
    return this.withVerifiedProof(proof, "login", undefined, identity => {
      const user = this.repository.findUserBySubject(identity.subject);
      if (user) {
        const sessionToken = randomBytes(32).toString("base64url");
        const createdAt = new Date(this.now()).toISOString();
        const expiresAt = new Date(this.now() + SESSION_LIFETIME_MS).toISOString();
        this.repository.createSession({ id: randomUUID(), userId: user.id, tokenHash: hash(sessionToken), createdAt, expiresAt });
        return { status: "signed_in", userId: user.id, sessionToken, expiresAt };
      }
      const ticket = this.tickets.issue(identity.subject, this.repository.deletionCheckpoint());
      return { status: "account_creation_required", creationTicket: ticket.token, expiresAt: new Date(ticket.expiresAt).toISOString() };
    }, signal);
  }

  assertCreationTicket(ticket: string): void {
    if (!this.tickets.check(ticket)) throw new CreationTicketRejectedError();
  }

  creationChallenge(ticket: string) {
    this.assertCreationTicket(ticket);
    const challengeId = randomUUID();
    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now() + CHALLENGE_LIFETIME_MS).toISOString();
    this.repository.createChallenge(challengeId, hash(nonce), expiresAt, "account_creation", hash(ticket));
    return { challengeId, nonce, expiresAt };
  }

  async completeAccountCreation(ticket: string, operationId: string, proof: AppleProof, signal?: AbortSignal): Promise<AccountCompletion | null> {
    try { if (!this.tickets.check(ticket)) return null; }
    catch (error) { if (error instanceof CreationTicketRejectedError) return null; throw error; }
    return this.withVerifiedProof(proof, "account_creation", hash(ticket), identity => {
      const checkpoint = this.tickets.check(ticket, identity.subject);
      if (!checkpoint) throw new CreationTicketRejectedError();
      this.repository.validateDeletionCheckpoint(checkpoint, identity.subject);
      this.tickets.reserve(ticket, identity.subject, operationId);
      let committed = false;
      try {
        const sessionToken = randomBytes(32).toString("base64url");
        const createdAt = new Date(this.now()).toISOString();
        const expiresAt = new Date(this.now() + SESSION_LIFETIME_MS).toISOString();
        const result = this.repository.createUserWithInitialSession(identity.subject, { id: randomUUID(), tokenHash: hash(sessionToken), createdAt, expiresAt });
        committed = result.status === "created";
        this.tickets.consume(ticket, operationId);
        if (result.status === "account_exists") return { status: "account_exists" };
        return { status: "created", userId: result.user.id, sessionToken, expiresAt };
      } catch (error) {
        if (!committed && error instanceof AuthPersistenceNotCommittedError) {
          this.tickets.releaseConfirmedFailure(ticket, operationId);
          return { status: "retry_required" };
        }
        try { this.tickets.requireRecovery(ticket, operationId); } catch { /* Missing/expired is already fail-closed. */ }
        return { status: "recovery_required" };
      }
    }, signal);
  }

  /** Internal coordination only; no HTTP deletion route is exposed. */
  deleteAccountData(userId: string): boolean {
    const user = this.repository.findUserById(userId);
    if (!user || !this.repository.deleteUserAndSessions(userId)) return false;
    this.tickets.invalidateSubject(user.appleSubject);
    return true;
  }

  private async withVerifiedProof<T>(proof: AppleProof, purpose: AuthChallengePurpose, ticketHash: string | undefined, action: (identity: VerifiedAppleIdentity) => T, signal?: AbortSignal): Promise<T | null> {
    if (!proof.identityToken || proof.identityToken.length > 16_384 || !proof.nonce || proof.nonce.length > 256 || !proof.challengeId) return null;
    let guard;
    try { guard = this.repository.beginLoginGuard(); }
    catch (error) { if (error instanceof LoginGuardRejectedError) return null; throw error; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      if (signal?.aborted) return null;
      if (!this.repository.consumeChallenge(proof.challengeId, hash(proof.nonce), new Date(this.now()).toISOString(), purpose, ticketHash)) return null;
      const identity = await Promise.race([
        this.verifier.verify(proof.identityToken, AUDIENCE, proof.nonce),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 20_000); }),
        new Promise<null>(resolve => { onAbort = () => resolve(null); signal?.addEventListener("abort", onAbort, { once: true }); }),
      ]);
      if (!identity || signal?.aborted) return null;
      this.repository.validateLoginGuard(guard, identity.subject);
      return action(identity);
    } catch (error) {
      if (error instanceof LoginGuardRejectedError || error instanceof CreationTicketRejectedError) return null;
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
      this.repository.releaseLoginGuard(guard);
    }
  }

  async signIn(identityToken: string, challengeId: string, nonce: string) {
    if (!identityToken || identityToken.length > 16_384 || !nonce || nonce.length > 256 || !challengeId) return null;
    let guard;
    try { guard = this.repository.beginLoginGuard(); }
    catch (error) { if (error instanceof LoginGuardRejectedError) return null; throw error; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const now = new Date(this.now()).toISOString();
      if (!this.repository.consumeChallenge(challengeId, hash(nonce), now)) return null;
      // Only the winning branch mutates account state; late verification is observed by race.
      const identity = await Promise.race([
        this.verifier.verify(identityToken, AUDIENCE, nonce),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 20_000); }),
      ]);
      if (!identity) return null;
      this.repository.validateLoginGuard(guard, identity.subject);
      const user = this.repository.getOrCreateUser(identity.subject, now);
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(this.now() + SESSION_LIFETIME_MS).toISOString();
      this.repository.createSession({ id: randomUUID(), userId: user.id, tokenHash: hash(token), createdAt: now, expiresAt });
      return { userId: user.id, sessionToken: token, expiresAt };
    } catch (error) {
      if (error instanceof LoginGuardRejectedError) return null;
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.repository.releaseLoginGuard(guard);
    }
  }

  session(token: string) {
    if (!token || token.length > 256) return null;
    const session = this.repository.findSession(hash(token), new Date(this.now()).toISOString());
    return session ? { userId: session.userId, expiresAt: session.expiresAt } : null;
  }

  logout(token: string): boolean {
    if (!token || token.length > 256) return false;
    return this.repository.revokeSession(hash(token), new Date(this.now()).toISOString());
  }
}
