import { resolveLocalPlan } from "./local-first-provider.js";
import type { NluProvider, RepairHint } from "./ports.js";
import type { ConversationContext, IntentResult } from "./types.js";
import type { PlanningTrace } from "./planning-provenance.js";

/** No fallback dependency: only reviewed whole-input templates may produce intent. */
export class FreeTemplateProvider implements NluProvider {
  async plan(input: string, context?: ConversationContext, _repair?: RepairHint,
             signal?: AbortSignal, trace?: PlanningTrace): Promise<IntentResult> {
    signal?.throwIfAborted();
    const result = resolveLocalPlan(input, context);
    if (result.route === "local_template") {
      trace?.localTemplate();
      return result.intent;
    }
    return { intent: "not_understood", confidence: 0, steps: [], entities: {}, missing: [], sourceText: input };
  }
}
