import { resolveProvider } from '../providers/index.mjs';
import { db } from '../db.mjs';
import { ulid } from '../util/ids.mjs';
import { atomicWriteSync, bucketedPath } from '../util/files.mjs';
import { promptHash } from '../util/hash.mjs';
import { paths } from '../paths.mjs';

export async function runGenerator({ prompt, refIds, providerName, goal, parentId = null, chainRunId = null, iteration = null, abortSignal }) {
  const provider = resolveProvider({ kind: 'image', name: providerName });
  const id = ulid();
  const ts = Date.now();
  const out = await provider.generate({ prompt, refs: refIds, abortSignal });
  const ext = out.mime === 'image/jpeg' ? 'jpg' : 'png';
  const { abs, rel } = bucketedPath(paths.generations, id, ext, ts);
  atomicWriteSync(abs, out.bytes);

  db().prepare(`
    INSERT INTO generations
      (id, created_at, parent_id, chain_run_id, iteration, goal, prompt, prompt_hash, ref_ids_json, provider, model, width, height, file_path)
    VALUES (@id,@ts,@parent,@chain,@iter,@goal,@prompt,@hash,@refs,@prov,@model,@w,@h,@path)
  `).run({
    id, ts, parent: parentId, chain: chainRunId, iter: iteration,
    goal, prompt, hash: promptHash(prompt, refIds),
    refs: JSON.stringify(refIds || []), prov: provider.name, model: provider.model,
    w: out.width, h: out.height, path: rel,
  });

  return {
    generationId: id,
    imagePath: `gen:${rel}`,
    relPath: rel,
    width: out.width, height: out.height,
    tokens: out.tokens || {},
    raw: { provider: provider.name, model: provider.model },
  };
}
