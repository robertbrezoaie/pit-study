import { randomFillSync, createHash } from 'node:crypto';

/** A source of uniform numbers in [0, 1). */
export type Rng = () => number;

/** Cryptographically secure uniform source, buffered for speed. */
export function createSecureRng(bufferSize = 4096): Rng {
  const buf = new Uint32Array(bufferSize * 2);
  let i = buf.length;
  return () => {
    if (i >= buf.length) {
      randomFillSync(buf);
      i = 0;
    }
    // 53 random bits -> double in [0, 1)
    const hi = buf[i++] >>> 5; // 27 bits
    const lo = buf[i++] >>> 6; // 26 bits
    return (hi * 67108864 + lo) / 9007199254740992;
  };
}

export const secureRandom: Rng = createSecureRng();

/** Deterministic PRNG (sfc32) seeded from a string; used for reproducible question selection. */
export function seededRng(seed: string): Rng {
  const h = createHash('sha256').update(seed).digest();
  let a = h.readUInt32LE(0);
  let b = h.readUInt32LE(4);
  let c = h.readUInt32LE(8);
  let d = h.readUInt32LE(12);
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}

export function randomInt(rng: Rng, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
