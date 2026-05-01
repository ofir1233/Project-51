import { db } from '../db.mjs';
import { ulid } from '../util/ids.mjs';
import { sseSend } from './events.mjs';
import { runArchitect } from '../agents/architect.mjs';
import { runPromptWriter } from '../agents/prompt-writer.mjs';
import { runGenerator } from '../agents/generator.mjs';
import { runStyleCritic } from '../agents/style-critic.mjs';
import { runPromptRefiner } from '../agents/prompt-refiner.mjs';
import { runAestheticJudge } from '../agents/aesthetic-judge.mjs';

const ACTIVE = new Map(); // runId -> AbortController

export function abortChain(runId) {
  const ac = ACTIVE.get(runId);
  if (ac) { ac.abort(); return true; }
  return false;
}

// Persist an agent_runs row, return its id.
function logAgentStart({ chainRunId, iteration, stepName, stepIndex, providerName, modelName, input }) {
  const id = ulid();
  db().prepare(`
    INSERT INTO agent_runs (id, chain_run_id, iteration, step_name, step_index, provider, model, input_json, started_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running')
  `).run(id, chainRunId, iteration, stepName, stepIndex, providerName, modelName, JSON.stringify(input || {}), Date.now());
  return id;
}
function logAgentFinish(id, { status, error, output, tokens, generationId }) {
  const ts = Date.now();
  const row = db().prepare('SELECT started_at FROM agent_runs WHERE id = ?').get(id);
  const latency = row ? ts - row.started_at : 0;
  db().prepare(`
    UPDATE agent_runs SET status=?, error=?, output_json=?, output_text=?,
      ended_at=?, latency_ms=?, prompt_tokens=?, output_tokens=?, total_tokens=?, generation_id=?
    WHERE id=?
  `).run(
    status, error || null,
    output ? JSON.stringify(output).slice(0, 200000) : null,
    output && typeof output === 'object' ? null : (output ?? null),
    ts, latency,
    tokens?.prompt ?? null, tokens?.output ?? null, tokens?.total ?? null,
    generationId ?? null,
    id,
  );
}

export async function runChain(res, { goal, refIds = [], maxIters = 3, scoreThreshold = 8.0, providerImage = 'gemini-image', providerText = 'gemini-text', refsAvailable = [] }) {
  const runId = ulid();
  const ac = new AbortController();
  ACTIVE.set(runId, ac);

  const cfg = { maxIters, scoreThreshold, providerImage, providerText, refIds };
  db().prepare(`INSERT INTO chain_runs (id, created_at, goal, config_json, status) VALUES (?, ?, ?, ?, 'running')`)
    .run(runId, Date.now(), goal, JSON.stringify(cfg));
  sseSend(res, 'run.started', { runId, goal, config: cfg });

  let stepIndex = 0;
  let bestGenId = null, bestScore = -Infinity;
  let plan = null, prompt = null, lastCritique = null;

  try {
    // STEP 0: Architect (once)
    {
      sseSend(res, 'iter.started', { runId, iteration: 0 });
      const aid = logAgentStart({ chainRunId: runId, iteration: 0, stepName: 'architect', stepIndex: ++stepIndex, providerName: providerText, modelName: providerText, input: { goal } });
      sseSend(res, 'agent.started', { runId, iteration: 0, agentRunId: aid, stepName: 'architect', provider: providerText });
      try {
        const r = await runArchitect({ goal, providerName: providerText });
        plan = r.plan;
        logAgentFinish(aid, { status: 'ok', output: r.plan, tokens: r.tokens });
        sseSend(res, 'agent.finished', { agentRunId: aid, stepName: 'architect', status: 'ok', tokens: r.tokens, output: r.plan });
      } catch (e) {
        logAgentFinish(aid, { status: 'error', error: e.message });
        sseSend(res, 'agent.finished', { agentRunId: aid, stepName: 'architect', status: 'error', error: e.message });
        plan = { layers: [], notes: 'architect failed' };
      }
    }

    // STEP 1: Prompt Writer (initial)
    {
      const aid = logAgentStart({ chainRunId: runId, iteration: 0, stepName: 'prompt_writer', stepIndex: ++stepIndex, providerName: providerText, modelName: providerText, input: { goal, plan } });
      sseSend(res, 'agent.started', { runId, iteration: 0, agentRunId: aid, stepName: 'prompt_writer', provider: providerText });
      try {
        const r = await runPromptWriter({ goal, plan, refs: refsAvailable, providerName: providerText });
        prompt = r.prompt;
        logAgentFinish(aid, { status: 'ok', output: { prompt: r.prompt, refsToUse: r.refsToUse }, tokens: r.tokens });
        sseSend(res, 'agent.finished', { agentRunId: aid, stepName: 'prompt_writer', status: 'ok', tokens: r.tokens, output: { prompt: r.prompt } });
      } catch (e) {
        logAgentFinish(aid, { status: 'error', error: e.message });
        sseSend(res, 'agent.finished', { agentRunId: aid, stepName: 'prompt_writer', status: 'error', error: e.message });
        prompt = goal;
      }
    }

    // ITERATIONS: generator → critic → (refiner if not done)
    for (let iter = 1; iter <= maxIters; iter++) {
      if (ac.signal.aborted) throw new Error('aborted');
      sseSend(res, 'iter.started', { runId, iteration: iter });

      let genResult = null;
      {
        const aid = logAgentStart({ chainRunId: runId, iteration: iter, stepName: 'generator', stepIndex: ++stepIndex, providerName: providerImage, modelName: providerImage, input: { prompt, refIds } });
        sseSend(res, 'agent.started', { runId, iteration: iter, agentRunId: aid, stepName: 'generator', provider: providerImage });
        try {
          genResult = await runGenerator({ prompt, refIds, providerName: providerImage, goal, chainRunId: runId, iteration: iter, abortSignal: ac.signal });
          logAgentFinish(aid, { status: 'ok', output: genResult.raw, tokens: genResult.tokens, generationId: genResult.generationId });
          sseSend(res, 'agent.finished', { agentRunId: aid, stepName: 'generator', status: 'ok', tokens: genResult.tokens, generationId: genResult.generationId });
        } catch (e) {
          logAgentFinish(aid, { status: 'error', error: e.message });
          sseSend(res, 'agent.finished', { agentRunId: aid, stepName: 'generator', status: 'error', error: e.message });
          continue; // skip to next iter
        }
      }

      // Critic
      let critique = null;
      {
        const aid = logAgentStart({ chainRunId: runId, iteration: iter, stepName: 'critic', stepIndex: ++stepIndex, providerName: providerText, modelName: providerText, input: { generationId: genResult.generationId } });
        sseSend(res, 'agent.started', { runId, iteration: iter, agentRunId: aid, stepName: 'critic', provider: providerText });
        try {
          critique = await runStyleCritic({ generationId: genResult.generationId, refIds, goal, providerName: providerText });
          lastCritique = critique;
          logAgentFinish(aid, { status: 'ok', output: critique, tokens: critique.tokens, generationId: genResult.generationId });
          sseSend(res, 'agent.finished', { agentRunId: aid, stepName: 'critic', status: 'ok', tokens: critique.tokens, output: { score: critique.score, gaps: critique.gaps } });
          sseSend(res, 'iter.scored', { runId, iteration: iter, generationId: genResult.generationId, score: critique.score, gaps: critique.gaps });
        } catch (e) {
          logAgentFinish(aid, { status: 'error', error: e.message });
          sseSend(res, 'agent.finished', { agentRunId: aid, stepName: 'critic', status: 'error', error: e.message });
        }
      }

      const score = critique?.score ?? -Infinity;
      if (score > bestScore) { bestScore = score; bestGenId = genResult.generationId; }
      sseSend(res, 'iter.finished', { runId, iteration: iter, bestSoFar: { generationId: bestGenId, score: bestScore } });

      if (score >= scoreThreshold) break;
      if (iter >= maxIters) break;

      // Refiner
      {
        const aid = logAgentStart({ chainRunId: runId, iteration: iter, stepName: 'refiner', stepIndex: ++stepIndex, providerName: providerText, modelName: providerText, input: { previousPrompt: prompt, critique } });
        sseSend(res, 'agent.started', { runId, iteration: iter, agentRunId: aid, stepName: 'refiner', provider: providerText });
        try {
          const r = await runPromptRefiner({ previousPrompt: prompt, critique, threshold: scoreThreshold, providerName: providerText });
          if (!r.done && r.prompt) prompt = r.prompt;
          logAgentFinish(aid, { status: 'ok', output: { done: r.done, changeSummary: r.changeSummary, newPrompt: r.prompt }, tokens: r.tokens });
          sseSend(res, 'agent.finished', { agentRunId: aid, stepName: 'refiner', status: 'ok', tokens: r.tokens, output: { done: r.done, changeSummary: r.changeSummary } });
          if (r.done) break;
        } catch (e) {
          logAgentFinish(aid, { status: 'error', error: e.message });
          sseSend(res, 'agent.finished', { agentRunId: aid, stepName: 'refiner', status: 'error', error: e.message });
        }
      }
    }

    // FINAL: Aesthetic Judge on the best generation
    if (bestGenId) {
      const aid = logAgentStart({ chainRunId: runId, iteration: 0, stepName: 'judge', stepIndex: ++stepIndex, providerName: providerText, modelName: providerText, input: { generationId: bestGenId } });
      sseSend(res, 'agent.started', { runId, iteration: 0, agentRunId: aid, stepName: 'judge', provider: providerText });
      try {
        const v = await runAestheticJudge({ generationId: bestGenId, refIds, providerName: providerText });
        logAgentFinish(aid, { status: 'ok', output: v, tokens: v.tokens, generationId: bestGenId });
        sseSend(res, 'agent.finished', { agentRunId: aid, stepName: 'judge', status: 'ok', tokens: v.tokens, output: { rating: v.rating, score: v.score, reasoning: v.reasoning, fewShotCount: v.fewShotCount } });
      } catch (e) {
        logAgentFinish(aid, { status: 'error', error: e.message });
        sseSend(res, 'agent.finished', { agentRunId: aid, stepName: 'judge', status: 'error', error: e.message });
      }
    }

    db().prepare(`UPDATE chain_runs SET status='done', ended_at=?, best_gen_id=? WHERE id=?`).run(Date.now(), bestGenId, runId);
    sseSend(res, 'run.finished', { runId, status: 'done', bestGenId, finalScore: bestScore });
  } catch (e) {
    const status = ac.signal.aborted ? 'aborted' : 'error';
    db().prepare(`UPDATE chain_runs SET status=?, ended_at=?, best_gen_id=?, error=? WHERE id=?`).run(status, Date.now(), bestGenId, e.message, runId);
    sseSend(res, status === 'aborted' ? 'run.finished' : 'run.error', { runId, status, message: e.message, bestGenId });
  } finally {
    ACTIVE.delete(runId);
  }
}
