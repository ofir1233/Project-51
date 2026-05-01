// ULID-style sortable IDs (no external dep). 26 chars, lex-sortable by time.
const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford
let lastTs = 0;
let lastRand = new Uint8Array(10);

export function ulid() {
  let ts = Date.now();
  if (ts <= lastTs) ts = lastTs;
  // monotonic within same ms
  if (ts === lastTs) {
    for (let i = 9; i >= 0; i--) {
      if (lastRand[i] < 0xff) { lastRand[i]++; break; }
      lastRand[i] = 0;
    }
  } else {
    crypto.getRandomValues(lastRand);
    lastTs = ts;
  }

  // 48-bit timestamp → 10 chars
  let tsPart = '';
  let n = ts;
  for (let i = 9; i >= 0; i--) { tsPart = ENC[n % 32] + tsPart; n = Math.floor(n / 32); }

  // 80-bit randomness → 16 chars
  let rndPart = '';
  let bits = 0, value = 0;
  for (const b of lastRand) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      rndPart += ENC[(value >> bits) & 31];
    }
  }
  return tsPart + rndPart.slice(0, 16);
}
