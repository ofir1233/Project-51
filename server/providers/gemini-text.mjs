import { config } from '../config.mjs';
import { readFileSync } from 'node:fs';
import { paths } from '../paths.mjs';
import { join } from 'node:path';

const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-preview'];

export const geminiText = config.geminiApiKey ? {
  kind: 'text',
  name: 'gemini-text',
  model: MODELS[0],
  ready: true,
  description: 'Gemini 2.5 Flash · text + vision',

  async generate({ system, user, attachments = [], abortSignal, onDelta, json: wantJson = false }) {
    if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY missing');

    const parts = [];
    if (user) parts.push({ text: user });
    for (const a of attachments) {
      const bytes = await resolveAttachment(a);
      if (bytes) parts.push({ inlineData: { mimeType: detectMime(bytes), data: bytes.toString('base64') } });
    }

    const body = {
      contents: [{ parts }],
      generationConfig: {
        ...(wantJson ? { responseMimeType: 'application/json' } : {}),
        temperature: 0.5,
      },
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
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
      if (!res.ok) throw new Error(`gemini-text ${res.status}: ${text.slice(0, 400)}`);
      const json = JSON.parse(text);
      const out = json?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n') || '';
      const usage = json.usageMetadata || {};
      return {
        text: out,
        raw: { model, response: json },
        tokens: { prompt: usage.promptTokenCount, output: usage.candidatesTokenCount, total: usage.totalTokenCount },
      };
    }
    throw lastErr || new Error('gemini-text failed');
  },
} : null;

async function resolveAttachment(a) {
  if (Buffer.isBuffer(a)) return a;
  if (typeof a === 'string') {
    if (a.startsWith('live:')) try { return readFileSync(join(paths.liveAssetsDir, a.slice(5))); } catch { return null; }
    if (a.startsWith('ref:'))  try { return readFileSync(join(paths.refs, a.slice(4))); } catch { return null; }
    if (a.startsWith('gen:'))  try { return readFileSync(join(paths.generations, a.slice(4))); } catch { return null; }
    if (a.startsWith('snap:')) try { return readFileSync(join(paths.snapshots, a.slice(5))); } catch { return null; }
  }
  return null;
}
function detectMime(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  return 'image/jpeg';
}
