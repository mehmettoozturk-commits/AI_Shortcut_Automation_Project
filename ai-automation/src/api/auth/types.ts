export interface VerifiedAppleIdentity {
  subject: string;
  issuer: string;
  audience: string;
  issuedAt: number;
  expiresAt: number;
}

/** Returns null for every untrusted/invalid credential; never exposes claims or tokens in errors. */
export interface AppleIdentityVerifier {
  verify(identityToken: string, expectedAudience: string, expectedNonce: string): Promise<VerifiedAppleIdentity | null>;
}

export interface AuthUser {
  id: string;
  appleSubject: string;
  createdAt: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface AuthRepository {
  deletionCheckpoint(): DeletionCheckpoint;
  validateDeletionCheckpoint(checkpoint: DeletionCheckpoint, verifiedSubject: string): void;
  findUserBySubject(appleSubject: string): AuthUser | null;
  findUserById(userId: string): AuthUser | null;
  createUserWithInitialSession(appleSubject: string, session: Omit<AuthSession, "userId">): CreateAccountResult;
  beginLoginGuard(): LoginGuard;
  validateLoginGuard(guard: LoginGuard, verifiedAppleSubject: string): void;
  releaseLoginGuard(guard: LoginGuard): void;
  deleteUserAndSessions(userId: string, receipt?: DeletionReceipt): boolean;
  findDeletionReceipt(deletionId: string, now: string): DeletionReceipt | null;
  updateRevocationStatus(deletionId: string, status: RevocationStatus, now: string): void;
  pruneDeletionReceipts(now: string): void;
  createChallenge(id: string, nonceHash: string, expiresAt: string, purpose?: AuthChallengePurpose, ticketHash?: string, accountId?: string): void;
  consumeChallenge(id: string, nonceHash: string, now: string, purpose?: AuthChallengePurpose, ticketHash?: string): boolean;
  getOrCreateUser(appleSubject: string, now: string): AuthUser;
  createSession(session: AuthSession): void;
  findSession(tokenHash: string, now: string): AuthSession | null;
  revokeSession(tokenHash: string, now: string): boolean;
}

export interface LoginGuard {
  readonly generation: number;
  readonly expiresAt: number;
}

export type CreateAccountResult =
  | { status: "created"; user: AuthUser; session: AuthSession }
  | { status: "account_exists" };

export type AuthChallengePurpose = "login" | "account_creation" | "account_deletion";

export type RevocationStatus = "not_configured" | "pending" | "succeeded" | "failed_retryable" | "failed_permanent";
export interface DeletionReceipt {
  deletionId: string;
  requestIdHash: string;
  subjectHash: string;
  accountGeneration: string;
  localDeletion: "committed";
  revocationStatus: RevocationStatus;
  createdAt: string;
  expiresAt: string;
}

export interface DeletionCheckpoint { readonly generation: number }
