/** Offline-only entry point. No .env loading, provider factory or transport. */
import { runMockEvaluation } from "../src/evaluation/runner.js";
import { turkishEvaluationCases } from "../src/evaluation/turkish-cases.js";

const { summary, results } = await runMockEvaluation(turkishEvaluationCases());
console.log(JSON.stringify({ ...summary, failures: results.filter(r => !r.passed).map(r => ({ id: r.id, failures: r.failures })) }, null, 2));
if (results.some(r => !r.passed)) process.exitCode = 1;
