import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AppleIdentityVerifier, AuthRepository } from "./types.js";

const AUDIENCE = "com.aishortcut.AutomationApp";
const CHALLENGE_LIFETIME_MS = 5 * 60_000;
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60_000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly verifier: AppleIdentityVerifier,
    private readonly now: () => number = Date.now
  ) {}

  challenge() {
    const challengeId = randomUUID();
    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now() + CHALLENGE_LIFETIME_MS).toISOString();
    this.repository.createChallenge(challengeId, hash(nonce), expiresAt);
    return { challengeId, nonce, expiresAt };
  }

  async signIn(identityToken: string, challengeId: string, nonce: string) {
    if (!identityToken || identityToken.length > 16_384 || !nonce || nonce.length > 256 || !challengeId) return null;
    const now = new Date(this.now()).toISOString();
    // Consume before any await: simultaneous requests can create at most one session.
    if (!this.repository.consumeChallenge(challengeId, hash(nonce), now)) return null;
    const identity = await this.verifier.verify(identityToken, AUDIENCE, nonce);
    if (!identity) return null;
    const user = this.repository.getOrCreateUser(identity.subject, now);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now() + SESSION_LIFETIME_MS).toISOString();
    this.repository.createSession({ id: randomUUID(), userId: user.id, tokenHash: hash(token), createdAt: now, expiresAt });
    return { userId: user.id, sessionToken: token, expiresAt };
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
