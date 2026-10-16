/** Hand-written synthetic selected fields, never captured from a real account. */
export function b2d1Fixture() {
  return { fixtureVersion: "groq-chat-synthetic-v1", configurationId: "offline-groq-20b-v1",
    reasoningAccounting: "completion_includes_reasoning", response: { object: "chat.completion", model: "openai/gpt-oss-20b",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"synthetic":true}', refusal: null } }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140, completion_tokens_details: { reasoning_tokens: 10 } } } };
}
export function b2d1Bound(repair = 0) {
  return { evidence: "synthetic-exact", modelId: "openai/gpt-oss-20b", tokenizerRevision: "mock-tokenizer-v1",
    components: { system: 20, schema: 30, user: 10, history: 0, repair, chatTemplateOverhead: 5 } };
}
