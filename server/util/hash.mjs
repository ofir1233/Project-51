import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

export function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
export function sha256File(path) {
  return sha256Buffer(readFileSync(path));
}
export function sizeOf(path) { return statSync(path).size; }

// Stable hash for prompt + ref ids (used to dedupe)
export function promptHash(prompt, refIds = []) {
  const refKey = [...refIds].sort().join('|');
  return sha256Buffer(Buffer.from(prompt + '|||' + refKey)).slice(0, 16);
}
