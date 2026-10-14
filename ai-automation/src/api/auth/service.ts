import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { AppleIdentityVerifier, AuthChallengePurpose, AuthRepository, VerifiedAppleIdentity } from "./types.js";
import { LoginGuardRejectedError } from "./login-guards.js";
import { CreationTicketRejectedError, CreationTicketStore } from "./creation-tickets.js";
import { AuthPersistenceNotCommittedError } from "./repository.js";
import type { DeletionReceipt, RevocationStatus } from "./types.js";
import { UnconfiguredRevocationAdapter, type RevocationAdapter } from "./revocation.js";

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
export type AccountDeletion =
  | { status: "account_deleted"; deletionId: string; serverAccountDeleted: true; localAutomationsDeleted: false; appleRevocation: { status: RevocationStatus } }
  | { status: "retry_required" | "recovery_required" };

export class AuthService {
  // Receipt hashes are pseudonymous, not anonymous. No stable raw subject tombstone.
  private readonly receiptKey = randomBytes(32);
  private storageRecoveryRequired = false;
  private readonly revocationAttempts = new Map<string, Promise<RevocationStatus>>();
  constructor(
    private readonly repository: AuthRepository,
    private readonly verifier: AppleIdentityVerifier,
    private readonly now: () => number = Date.now,
    private readonly tickets = new CreationTicketStore(now),
    private readonly revocation: RevocationAdapter = new UnconfiguredRevocationAdapter()
  ) {}

  challenge() {
    this.assertStorageAvailable();
    const challengeId = randomUUID();
    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now() + CHALLENGE_LIFETIME_MS).toISOString();
    this.repository.createChallenge(challengeId, hash(nonce), expiresAt);
    return { challengeId, nonce, expiresAt };
  }

  async prepareAccountCreation(proof: AppleProof, signal?: AbortSignal): Promise<AccountPreparation | null> {
    this.assertStorageAvailable();
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
    this.assertStorageAvailable();
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
    this.assertStorageAvailable();
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
  deleteAccountData(userId: string, receipt?: DeletionReceipt): boolean {
    this.assertStorageAvailable();
    const user = this.repository.findUserById(userId);
    if (!user || !this.repository.deleteUserAndSessions(userId, receipt)) return false;
    this.tickets.invalidateSubject(user.appleSubject);
    return true;
  }

  private keyed(value: string): string { return createHmac("sha256", this.receiptKey).update(value).digest("hex"); }
  private assertStorageAvailable(): void {
    if (this.storageRecoveryRequired) throw new Error("Auth storage recovery required.");
  }
  private markStorageFailure(error: unknown): void {
    if (!(error instanceof AuthPersistenceNotCommittedError)) this.storageRecoveryRequired = true;
  }
  pruneDeletionReceipts(): void {
    if (this.storageRecoveryRequired) return;
    try { this.repository.pruneDeletionReceipts(new Date(this.now()).toISOString()); }
    catch (error) { this.markStorageFailure(error); }
  }

  deletionChallenge(token: string, requestId: string) {
    this.assertStorageAvailable();
    const session = this.repository.findSession(hash(token), new Date(this.now()).toISOString());
    if (!session) return null;
    const user = this.repository.findUserById(session.userId);
    if (!user) return null;
    const challengeId = randomUUID();
    const nonce = randomBytes(32).toString("base64url");
    const binding = this.keyed(JSON.stringify([session.id, user.id, requestId]));
    this.repository.createChallenge(challengeId, hash(nonce), new Date(this.now() + CHALLENGE_LIFETIME_MS).toISOString(), "account_deletion", binding, user.id);
    return { challengeId, nonce, purpose: "account_deletion", expiresInSeconds: 300 };
  }

  async deleteAccount(token: string, requestId: string, proof: AppleProof, signal?: AbortSignal): Promise<AccountDeletion | null> {
    this.assertStorageAvailable();
    const session = this.repository.findSession(hash(token), new Date(this.now()).toISOString());
    if (!session) return null;
    const user = this.repository.findUserById(session.userId);
    if (!user) return null;
    const binding = this.keyed(JSON.stringify([session.id, user.id, requestId]));
    const outcome = await this.withVerifiedProof<AccountDeletion>(proof, "account_deletion", binding, identity => {
      const live = this.repository.findSession(hash(token), new Date(this.now()).toISOString());
      const current = this.repository.findUserById(user.id);
      if (!live || live.id !== session.id || !current || current.appleSubject !== identity.subject || identity.subject !== user.appleSubject) {
        throw new LoginGuardRejectedError();
      }
      const receipt: DeletionReceipt = {
        deletionId: randomUUID(), requestIdHash: this.keyed(requestId), subjectHash: this.keyed(identity.subject),
        accountGeneration: this.keyed(user.id), localDeletion: "committed",
        revocationStatus: this.revocation.configured ? "pending" : "not_configured",
        createdAt: new Date(this.now()).toISOString(), expiresAt: new Date(this.now() + 7 * 24 * 60 * 60_000).toISOString(),
      };
      try {
        if (!this.deleteAccountData(user.id, receipt)) throw new Error("Deletion result unavailable.");
        return { status: "account_deleted", deletionId: receipt.deletionId, serverAccountDeleted: true, localAutomationsDeleted: false, appleRevocation: { status: receipt.revocationStatus } };
      } catch (error) {
        // A custom/uncertain commit cannot leave stale in-memory sessions trusted.
        // File adapter precommit failures remain retryable; uncertainty needs restart/reconciliation.
        if (!(error instanceof AuthPersistenceNotCommittedError)) this.storageRecoveryRequired = true;
        return { status: error instanceof AuthPersistenceNotCommittedError ? "retry_required" : "recovery_required" };
      }
    }, signal);
    if (outcome?.status !== "account_deleted" || !this.revocation.configured) return outcome;
    // External work is strictly after the local commit; no transaction spans Apple.
    const status = await this.retryRevocation(outcome.deletionId);
    return { ...outcome, appleRevocation: { status } };
  }

  async retryRevocation(deletionId: string): Promise<RevocationStatus> {
    const existing = this.revocationAttempts.get(deletionId);
    if (existing) return existing;
    if (this.revocationAttempts.size >= 32) return "failed_retryable";
    const pending = this.performRevocation(deletionId).finally(() => { this.revocationAttempts.delete(deletionId); });
    this.revocationAttempts.set(deletionId, pending);
    return pending;
  }

  private async performRevocation(deletionId: string): Promise<RevocationStatus> {
    this.assertStorageAvailable();
    let receipt: DeletionReceipt | null;
    try { receipt = this.repository.findDeletionReceipt(deletionId, new Date(this.now()).toISOString()); }
    catch (error) { this.markStorageFailure(error); return "failed_retryable"; }
    if (!receipt || receipt.revocationStatus === "not_configured" || !this.revocation.configured) return "not_configured";
    if (receipt.revocationStatus === "succeeded" || receipt.revocationStatus === "failed_permanent") return receipt.revocationStatus;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let status: RevocationStatus;
    try {
      status = await Promise.race([this.revocation.revoke(deletionId), new Promise<RevocationStatus>(resolve => { timer = setTimeout(() => resolve("failed_retryable"), 10_000); })]);
    } catch { status = "failed_retryable"; }
    finally { if (timer) clearTimeout(timer); }
    if (this.storageRecoveryRequired) return receipt.revocationStatus;
    try { this.repository.updateRevocationStatus(deletionId, status, new Date(this.now()).toISOString()); }
    catch (error) { this.markStorageFailure(error); return receipt.revocationStatus; }
    return status;
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
      this.assertStorageAvailable();
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
    this.assertStorageAvailable();
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
      this.assertStorageAvailable();
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
    this.assertStorageAvailable();
    if (!token || token.length > 256) return null;
    const session = this.repository.findSession(hash(token), new Date(this.now()).toISOString());
    return session ? { userId: session.userId, expiresAt: session.expiresAt } : null;
  }

  logout(token: string): boolean {
    this.assertStorageAvailable();
    if (!token || token.length > 256) return false;
    return this.repository.revokeSession(hash(token), new Date(this.now()).toISOString());
  }
}
