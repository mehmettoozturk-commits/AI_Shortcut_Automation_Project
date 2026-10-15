/** Server-created identity only. Never hydrate from a plan body/conversation. */
export type RoutingSubject = Readonly<{ kind: "guest" } | { kind: "account"; userId: string }>;

export type RoutingAccess =
  | Readonly<{ access: "free"; basis: "guest" | "no_premium" | "development_free" }>
  | Readonly<{ access: "premium"; basis: "verified_entitlement" }>
  | Readonly<{ access: "unavailable"; basis: "unresolved" }>;

export type AccessResolver = (subject: RoutingSubject, signal: AbortSignal) => Promise<RoutingAccess>;

/** An account alone is not an entitlement. P4 supplies authoritative evidence. */
export const defaultAccessResolver: AccessResolver = async subject => Object.freeze(
  subject.kind === "guest"
    ? { access: "free" as const, basis: "guest" as const }
    : { access: "unavailable" as const, basis: "unresolved" as const });

/** Explicit development fixture, never selected implicitly in production. */
export const developmentFreeAccessResolver: AccessResolver = async () =>
  Object.freeze({ access: "free", basis: "development_free" });

/** Copy/validate even trusted plugin output before retaining the decision. */
export function snapshotRoutingAccess(value: RoutingAccess, subject: RoutingSubject): RoutingAccess {
  if (value?.access === "premium" && value.basis === "verified_entitlement" && subject.kind === "account") {
    return Object.freeze({ access: "premium", basis: "verified_entitlement" });
  }
  if (value?.access === "free" && ["guest", "no_premium", "development_free"].includes(value.basis)
    && (value.basis !== "guest" || subject.kind === "guest")) {
    return Object.freeze({ access: "free", basis: value.basis });
  }
  return Object.freeze({ access: "unavailable", basis: "unresolved" });
}
