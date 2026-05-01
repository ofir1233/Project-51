import { Router } from 'express';
import { db } from '../db.mjs';
import { runChain, abortChain } from '../orchestrator/chain.mjs';
import { sseHead, sseSend, sseEnd } from '../orchestrator/events.mjs';
import { config } from '../config.mjs';
import { runPromptRefiner } from '../agents/prompt-refiner.mjs';
import { runGenerator } from '../agents/generator.mjs';
import { ulid } from '../util/ids.mjs';

export const chainRouter = Router();

chainRouter.post('/chain/run', async (req, res) => {
  const { goal, refIds = [], maxIters = 3, scoreThreshold = 8.0, provider } = req.body || {};
  if (!goal) return res.status(400).json({ error: 'goal required' });
  // SSE
  sseHead(res);
  // Build refsAvailable for prompt-writer
  const refsAvailable = refIds.map(id => ({ id, name: id.replace(/^[a-z]+:/, ''), kind: id.split(':')[0] }));
  const providerImage = provider || config.defaultImageProvider;
  const providerText  = config.defaultTextProvider;

  // heartbeat
  const heartbeat = setInterval(() => sseSend(res, 'heartbeat', { ts: Date.now() }), 15000);
  req.on('close', () => clearInterval(heartbeat));

  try {
    await runChain(res, { goal, refIds, maxIters, scoreThreshold, providerImage, providerText, refsAvailable });
  } catch (e) {
    sseSend(res, 'run.error', { message: e.message });
  } finally {
    clearInterval(heartbeat);
    sseEnd(res);
  }
});

chainRouter.post('/chain/:id/abort', (req, res) => {
  const ok = abortChain(req.params.id);
  res.json({ aborted: ok });
});

chainRouter.get('/chain/:id', (req, res) => {
  const run = db().prepare('SELECT * FROM chain_runs WHERE id = ?').get(req.params.id);
  if (!run) return res.status(404).json({ error: 'not found' });
  const agentRuns = db().prepare('SELECT * FROM agent_runs WHERE chain_run_id = ? ORDER BY step_index').all(req.params.id);
  const generations = db().prepare('SELECT id, prompt, score, file_path, created_at, iteration FROM generations WHERE chain_run_id = ? ORDER BY iteration, created_at').all(req.params.id);
  res.json({ run, agentRuns, generations });
});

// Refine-once · take an existing generation, the user's text feedback,
// run the refiner with the feedback as a forced gap, then run the generator.
// Returns the new generation. Logs feedback in improvement_feedback.
chainRouter.post('/chain/refine-once', async (req, res) => {
  const { generationId, feedback } = req.body || {};
  if (!generationId || !feedback) return res.status(400).json({ error: 'generationId+feedback required' });
  const gen = db().prepare('SELECT * FROM generations WHERE id = ?').get(generationId);
  if (!gen) return res.status(404).json({ error: 'generation not found' });

  const fbId = ulid();
  db().prepare(`
    INSERT INTO improvement_feedback (id, generation_id, feedback_text, created_at)
    VALUES (?, ?, ?, ?)
  `).run(fbId, generationId, feedback, Date.now());

  // Build a synthetic critique that the refiner treats as the gap list.
  const synthCritique = {
    score: 0,
    axes: { user_request: 0 },
    gaps: [feedback],
    notes: 'user-supplied improvement request',
  };

  try {
    const r = await runPromptRefiner({
      previousPrompt: gen.prompt,
      critique: synthCritique,
      threshold: 99,                     // force "not done" so we always rewrite
      providerName: config.defaultTextProvider,
    });
    const newPrompt = r.prompt || gen.prompt;
    const refIds = JSON.parse(gen.ref_ids_json || '[]');
    const newGen = await runGenerator({
      prompt: newPrompt,
      refIds,
      providerName: gen.provider,
      goal: gen.goal,
      parentId: generationId,
      chainRunId: gen.chain_run_id,
    });
    db().prepare('UPDATE improvement_feedback SET follow_up_id = ? WHERE id = ?')
      .run(newGen.generationId, fbId);
    const newRow = db().prepare('SELECT * FROM generations WHERE id = ?').get(newGen.generationId);
    res.json({ generation: newRow, refinerNotes: r.changeSummary || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

chainRouter.get('/chain', (req, res) => {
  const rows = db().prepare('SELECT * FROM chain_runs ORDER BY created_at DESC LIMIT 50').all();
  res.json({ items: rows });
});
