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
  deleteUserAndSessions(userId: string): boolean;
  createChallenge(id: string, nonceHash: string, expiresAt: string): void;
  consumeChallenge(id: string, nonceHash: string, now: string): boolean;
  getOrCreateUser(appleSubject: string, now: string): AuthUser;
  createSession(session: AuthSession): void;
  findSession(tokenHash: string, now: string): AuthSession | null;
  revokeSession(tokenHash: string, now: string): boolean;
}
