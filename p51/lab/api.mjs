// Lightweight wrappers around /api endpoints. Token stays in memory only.
let _token = null;
export function setLabToken(t) { _token = t; }

async function call(method, path, body) {
  const headers = { 'Accept': 'application/json' };
  if (_token) headers['X-Lab-Token'] = _token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${res.status} ${path} :: ${txt.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  health: ()                              => call('GET',   '/api/health'),
  providers: ()                           => call('GET',   '/api/providers'),
  generations: (filters = {})             => call('GET',   '/api/generations?' + new URLSearchParams(filters)),
  getGeneration: (id)                     => call('GET',   `/api/generations/${id}`),
  patchGeneration: (id, patch)            => call('PATCH', `/api/generations/${id}`, patch),
  generateStandalone: (body)              => call('POST',  '/api/generations/standalone', body),
  refsList: ()                            => call('GET',   '/api/refs'),
  uploadRef: (body)                       => call('POST',  '/api/refs', body),
  deleteRef: (name)                       => call('DELETE',`/api/refs/${encodeURIComponent(name)}`),
  addJudgment: (body)                     => call('POST',  '/api/judgments', body),
  judgmentsList: (filters = {})           => call('GET',   '/api/judgments?' + new URLSearchParams(filters)),
  elementsList: (generationId)            => call('GET',   `/api/elements?generationId=${encodeURIComponent(generationId)}`),
  detectElements: (generationId)          => call('POST',  '/api/elements/detect', { generationId }),
  addElement: (body)                      => call('POST',  '/api/elements', body),
  deleteElement: (id)                     => call('DELETE',`/api/elements/${id}`),
  clearElements: (generationId)           => call('DELETE',`/api/elements?generationId=${encodeURIComponent(generationId)}`),
  getSceneGraph: (generationId)           => call('GET',   `/api/scene-graphs/${generationId}`),
  saveSceneGraph: (generationId, graph)   => call('PUT',   `/api/scene-graphs/${generationId}`, { graph }),
  refineOnce: (generationId, feedback)    => call('POST',  '/api/chain/refine-once', { generationId, feedback }),
  tunables: ()                            => call('GET',   '/api/tunables'),
  setTunable: (key, value)                => call('PUT',   '/api/tunables', { key, value }),
  snapshotsList: (slot)                   => call('GET',   '/api/snapshots' + (slot ? `?slot=${encodeURIComponent(slot)}` : '')),
  snapshotNow: (body)                     => call('POST',  '/api/snapshots', body),
  restoreSnapshot: (id)                   => call('POST',  `/api/snapshots/${id}/restore`),
  approve: (body)                         => call('POST',  '/api/approvals', body),
};
