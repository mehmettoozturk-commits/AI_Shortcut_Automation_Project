import type { RevocationStatus } from "./types.js";

/** No live Apple calls or user tokens are accepted by this local-development adapter. */
export interface RevocationAdapter {
  readonly configured: boolean;
  revoke(deletionId: string): Promise<RevocationStatus>;
}
export class UnconfiguredRevocationAdapter implements RevocationAdapter {
  readonly configured = false;
  async revoke(_deletionId: string): Promise<RevocationStatus> { return "not_configured"; }
}
