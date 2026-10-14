import type { Rng } from './random';

/** Standard normal via the Marsaglia polar method. */
function normal(rng: Rng): number {
  for (;;) {
    const u = 2 * rng() - 1;
    const v = 2 * rng() - 1;
    const s = u * u + v * v;
    if (s > 0 && s < 1) return u * Math.sqrt((-2 * Math.log(s)) / s);
  }
}

/** Gamma(shape, 1) by Marsaglia–Tsang. Requires shape >= 1 (always true here: Beta params start at 1). */
export function sampleGamma(shape: number, rng: Rng): number {
  if (!(shape >= 1)) throw new Error(`sampleGamma requires shape >= 1, got ${shape}`);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Beta(a, b) = X / (X + Y) with X ~ Gamma(a), Y ~ Gamma(b). */
export function sampleBeta(a: number, b: number, rng: Rng): number {
  const x = sampleGamma(a, rng);
  const y = sampleGamma(b, rng);
  return x / (x + y);
}
