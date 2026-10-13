import { createPublicKey, verify as verifySignature, type JsonWebKey } from "node:crypto";
import type { AppleIdentityVerifier, VerifiedAppleIdentity } from "./types.js";

interface AppleKey extends JsonWebKey { kid?: string; alg?: string; use?: string }
type KeyLoader = () => Promise<AppleKey[]>;

async function loadAppleKeys(): Promise<AppleKey[]> {
  const response = await fetch("https://appleid.apple.com/auth/keys", { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Apple key lookup failed");
  const document = await response.json() as { keys?: AppleKey[] };
  return Array.isArray(document.keys) ? document.keys : [];
}

/** Production verifier. Only Apple's matching RSA signing key may validate a token. */
export class AppleJWKSVerifier implements AppleIdentityVerifier {
  private cache?: { keys: AppleKey[]; loadedAt: number };

  constructor(private readonly loadKeys: KeyLoader = loadAppleKeys, private readonly now: () => number = Date.now) {}

  async verify(identityToken: string, expectedAudience: string, expectedNonce: string): Promise<VerifiedAppleIdentity | null> {
    try {
      if (identityToken.length > 16_384) return null;
      const segments = identityToken.split(".");
      if (segments.length !== 3) return null;
      const [encodedHeader, encodedPayload, encodedSignature] = segments;
      if (!encodedHeader || !encodedPayload || !encodedSignature) return null;
      const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as Record<string, unknown>;
      const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Record<string, unknown>;
      if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) return null;
      const keys = await this.keys();
      const key = keys.find((item) => item.kid === header.kid && item.kty === "RSA" && item.alg === "RS256" && item.use === "sig");
      if (!key) return null;
      const publicKey = createPublicKey({ key, format: "jwk" });
      const signed = Buffer.from(`${encodedHeader}.${encodedPayload}`);
      if (!verifySignature("RSA-SHA256", signed, publicKey, Buffer.from(encodedSignature, "base64url"))) return null;
      const nowSeconds = Math.floor(this.now() / 1000);
      if (claims.iss !== "https://appleid.apple.com" || claims.aud !== expectedAudience || claims.nonce !== expectedNonce) return null;
      if (typeof claims.sub !== "string" || !claims.sub || typeof claims.iat !== "number" || typeof claims.exp !== "number") return null;
      if (claims.iat > nowSeconds + 60 || claims.exp <= nowSeconds || claims.exp <= claims.iat) return null;
      return { subject: claims.sub, issuer: claims.iss, audience: claims.aud, issuedAt: claims.iat, expiresAt: claims.exp };
    } catch {
      return null;
    }
  }

  private async keys(): Promise<AppleKey[]> {
    const now = this.now();
    if (this.cache && now - this.cache.loadedAt < 3_600_000) return this.cache.keys;
    const keys = await this.loadKeys();
    this.cache = { keys, loadedAt: now };
    return keys;
  }
}
