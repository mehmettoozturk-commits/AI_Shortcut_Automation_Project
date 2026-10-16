import { LP2Journal } from "./lp2-journal.js";
import { label, natural, priceOf } from "./lp2-types.js";

export interface LP2SyntheticProvider {
  readonly mode: "offline/mock";
  readonly configurationId: string;
  readonly modelId: string;
  call(signal: AbortSignal, attempt: 0 | 1): Promise<{ usage: unknown; repairNeeded: boolean }>;
}
/** Offline test seam only. No SDK, HTTP, environment, factory or production import. */
export async function runLP2Offline(journal: LP2Journal, provider: LP2SyntheticProvider,
  runId: string, maxima: Readonly<{ input: number; output: number }>, signal?: AbortSignal,
  deadline = performance.now() + 45_000): Promise<"settled" | "stopped"> {
  label(runId); natural(maxima.input); natural(maxima.output);
  if (!Number.isFinite(deadline)) throw new Error("invalid_deadline");
  const context = Object.freeze({ configurationId: provider.configurationId, modelId: provider.modelId, input: maxima.input, output: maxima.output });
  if (provider.mode !== "offline/mock" || context.configurationId !== journal.price.configurationId || context.modelId !== journal.price.modelId) throw new Error("synthetic_configuration_required");
  const end = Math.min(deadline, performance.now() + 45_000);
  const dispatch = provider.call.bind(provider);
  for (const attempt of [0, 1] as const) {
    if (journal.isStopped) return "stopped";
    if (provider.mode !== "offline/mock" || provider.modelId !== context.modelId || provider.configurationId !== context.configurationId) {
      journal.stop(); return "stopped";
    }
    if (signal?.aborted || performance.now() >= end) {
      if (attempt === 1) journal.stop();
      return "stopped";
    }
    const id = `${runId}_${attempt}`;
    journal.reserve({ id, runId, attempt, configurationId: context.configurationId, input: context.input,
      output: context.output, microUsd: priceOf(context.input, context.output, journal.price) });
    // Time and external cancellation checked again after synchronous durable I/O.
    if (signal?.aborted || performance.now() >= end) { journal.unknown(id); return "stopped"; }
    journal.dispatch(id);
    if (signal?.aborted || performance.now() >= end) { journal.unknown(id); return "stopped"; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const interrupted = new Promise<never>((_, reject) => {
        abort = () => { controller.abort(); reject(new Error("interrupted")); };
        signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(abort, Math.min(20_000, Math.max(0, end - performance.now())));
      });
      const result = await Promise.race([interrupted, dispatch(controller.signal, attempt)]);
      if (controller.signal.aborted || signal?.aborted || performance.now() >= end) { journal.unknown(id); return "stopped"; }
      journal.settle(id, result.usage, result.repairNeeded === true);
      if (journal.isStopped) return "stopped";
      if (signal?.aborted || performance.now() >= end) { journal.stop(); return "stopped"; }
      if (!result.repairNeeded) return "settled";
      if (attempt === 1) { journal.stop(); return "stopped"; }
    } catch {
      if (!journal.isStopped) journal.unknown(id);
      return "stopped";
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) signal?.removeEventListener("abort", abort);
    }
  }
  return "stopped";
}
