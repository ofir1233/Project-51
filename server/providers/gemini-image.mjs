import { config } from '../config.mjs';
import { readFileSync, statSync } from 'node:fs';
import { paths } from '../paths.mjs';
import { join } from 'node:path';

const MODELS = ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview'];

export const geminiImage = config.geminiApiKey ? {
  kind: 'image',
  name: 'gemini-image',
  model: MODELS[0],
  ready: true,
  description: 'Gemini 2.5 Flash Image · image-to-image',

  async generate({ prompt, refs = [], abortSignal }) {
    if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY missing');

    const parts = [{ text: prompt }];
    for (const r of refs) {
      // Accept either raw Buffers (online flow, ref image uploaded by user)
      // or string IDs ('live:...', 'ref:...') that map to local files
      // (local Lab flow). Anything else is silently skipped.
      const buf = Buffer.isBuffer(r) ? r : await loadRefBytes(r);
      if (!buf) continue;
      parts.push({ inlineData: { mimeType: detectMime(buf), data: buf.toString('base64') } });
    }

    const body = {
      contents: [{ parts }],
      generationConfig: { responseModalities: ['IMAGE'] },
    };

    let lastErr = null;
    for (const model of MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
        body: JSON.stringify(body),
        signal: abortSignal,
      });
      const text = await res.text();
      if (res.status === 404) { lastErr = new Error('model not found: ' + model); continue; }
      if (!res.ok) throw new Error(`gemini-image ${res.status}: ${text.slice(0, 400)}`);
      const json = JSON.parse(text);
      const ps = json?.candidates?.[0]?.content?.parts || [];
      const img = ps.find(p => p.inlineData?.data);
      if (!img) throw new Error('no image in response: ' + text.slice(0, 200));

      const bytes = Buffer.from(img.inlineData.data, 'base64');
      const usage = json.usageMetadata || {};
      return {
        bytes,
        mime: img.inlineData.mimeType || 'image/png',
        width: null, height: null,
        raw: { model, usage },
        tokens: { prompt: usage.promptTokenCount, output: usage.candidatesTokenCount, total: usage.totalTokenCount },
      };
    }
    throw lastErr || new Error('gemini-image failed');
  },
} : null;

async function loadRefBytes(refId) {
  // refId formats: 'live:filename.jpg' (in p51/assets/), 'ref:filename.jpg' (in .lab/refs/)
  if (typeof refId !== 'string') return null;
  if (refId.startsWith('live:')) {
    const f = refId.slice(5);
    const p = join(paths.liveAssetsDir, f);
    try { return readFileSync(p); } catch { return null; }
  }
  if (refId.startsWith('ref:')) {
    const f = refId.slice(4);
    const p = join(paths.refs, f);
    try { return readFileSync(p); } catch { return null; }
  }
  return null;
}

function detectMime(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  return 'image/jpeg';
}
