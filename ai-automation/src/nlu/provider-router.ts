import type { NluProvider, RepairHint } from "./ports.js";
import type { ConversationContext, IntentResult } from "./types.js";
import type { PlanningObserver, PlanningTrace } from "./planning-provenance.js";
import { LlmProviderError } from "./providers/errors.js";
import { snapshotRoutingAccess, type AccessResolver, type RoutingSubject } from "./routing-access.js";

export type RoutingChannel = "free" | "premium";
export interface ChannelConfiguration {
  readonly channel: RoutingChannel;
  /** Non-secret deployment label, safe for internal diagnostics. */
  readonly configurationId: string;
  readonly providerId: "anthropic" | "gemini" | "groq" | "nvidia";
  readonly model: string;
  /** Symbolic reference only: no API key value or general-key fallback. */
  readonly keyReference: string;
}
export interface ChannelBinding {
  readonly configuration: ChannelConfiguration;
  readonly enabled: boolean;
  readonly provider: NluProvider;
}
export type ChannelBindings = Readonly<Partial<Record<RoutingChannel, ChannelBinding>>>;
export interface ProviderRoutingOptions {
  /** Only explicit true selects the router. serve.ts does not set this. */
  readonly enabled?: boolean;
  readonly channels?: ChannelBindings;
  readonly resolveAccess?: AccessResolver;
  readonly resolverTimeoutMs?: number;
  readonly onPlanningComplete?: PlanningObserver;
}

const blocked = () => new LlmProviderError("AI yönlendirmesi şu anda kullanılamıyor.", undefined, false);
const label = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/** Snapshot configuration, but do not freeze mutable SDK client internals. */
export function snapshotChannelBindings(bindings: ChannelBindings = {}): ChannelBindings {
  const copy: Partial<Record<RoutingChannel, ChannelBinding>> = {};
  for (const channel of ["free", "premium"] as const) {
    const binding = bindings[channel];
    if (binding) copy[channel] = Object.freeze({ enabled: binding.enabled, provider: binding.provider,
      configuration: Object.freeze({ ...binding.configuration }) });
  }
  return Object.freeze(copy);
}

function validBinding(binding: ChannelBinding | undefined, channel: RoutingChannel): binding is ChannelBinding {
  if (!binding || binding.enabled !== true || typeof binding.provider?.plan !== "function") return false;
  const config = binding.configuration;
  return config.channel === channel && typeof config.configurationId === "string" && label.test(config.configurationId)
    && !/^(?:sk-|nvapi-|gh[pousr]_)/i.test(config.configurationId)
    && ["anthropic", "gemini", "groq", "nvidia"].includes(config.providerId)
    && typeof config.model === "string" && config.model.trim().length > 0 && config.model.length <= 128
    && /^[A-Z][A-Z0-9_]{0,63}$/.test(config.keyReference) && config.keyReference !== "LLM_API_KEY";
}

/** One instance per HTTP request. The memoized selection also binds repair. */
export class RequestProviderRouter implements NluProvider {
  private owner?: PlanningTrace;
  private selection?: Promise<ChannelBinding>;

  constructor(
    private readonly channels: ChannelBindings,
    private readonly resolveAccess: (signal: AbortSignal) => ReturnType<AccessResolver>,
    private readonly resolverTimeoutMs = 2_000,
  ) { this.channels = snapshotChannelBindings(channels); }

  async plan(input: string, context?: ConversationContext, repair?: RepairHint, signal?: AbortSignal, trace?: PlanningTrace): Promise<IntentResult> {
    signal?.throwIfAborted();
    if (!trace || (this.owner && this.owner !== trace)) throw blocked();
    this.owner = trace;
    this.selection ??= this.select(signal, trace);
    const binding = await this.selection;
    signal?.throwIfAborted();
    return binding.provider.plan(input, context, repair, signal, trace);
  }

  private async select(signal: AbortSignal | undefined, trace: PlanningTrace): Promise<ChannelBinding> {
    trace.requireAI();
    try {
      const access = await this.resolveBounded(signal);
      signal?.throwIfAborted();
      if (access.access === "unavailable") {
        trace.routerSelection("unavailable", null);
        throw blocked();
      }
      const channel = access.access;
      const binding = this.channels[channel];
      trace.routerSelection(channel, validBinding(binding, channel) ? binding.configuration.configurationId : null);
      if (!validBinding(binding, channel)) throw blocked();
      const other = this.channels[channel === "free" ? "premium" : "free"];
      if (other && (other.configuration.keyReference === binding.configuration.keyReference
        || other.configuration.configurationId === binding.configuration.configurationId)) throw blocked();
      return binding;
    } catch {
      trace.routerBlocked();
      throw blocked();
    }
  }

  /** Bounds even an uncooperative resolver; late results never dispatch. */
  private async resolveBounded(signal?: AbortSignal) {
    const timeout = Number.isFinite(this.resolverTimeoutMs) && this.resolverTimeoutMs > 0
      ? Math.min(this.resolverTimeoutMs, 5_000) : 2_000;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await new Promise<Awaited<ReturnType<AccessResolver>>>((resolve, reject) => {
        onAbort = () => { controller.abort(); reject(blocked()); };
        if (signal?.aborted) { onAbort(); return; }
        signal?.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(onAbort, timeout);
        Promise.resolve().then(() => this.resolveAccess(controller.signal)).then(resolve, reject);
      });
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
  }
}

/** Only a server identity resolver can provide a subject to this boundary. */
export function bindAccessResolver(subject: () => RoutingSubject | null, resolver: AccessResolver) {
  return async (signal: AbortSignal) => {
    const identity = subject();
    if (!identity) return Object.freeze({ access: "unavailable" as const, basis: "unresolved" as const });
    return snapshotRoutingAccess(await resolver(identity, signal), identity);
  };
}
