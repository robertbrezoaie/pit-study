import { pick, randomInt, secureRandom, type Rng } from './random';

export const CREATURES = [
  'Pinguin', 'Vulpe', 'Delfin', 'Dragon', 'Lama', 'Panda', 'Koala', 'Cameleon', 'Arici', 'Rechin',
  'Tigru', 'Lup', 'Ponei', 'Melc', 'Hamster', 'Capibara', 'Axolotl', 'Flamingo', 'Iepure', 'Elefant',
  'Pelican', 'Papagal', 'Leu', 'Urs', 'Bursuc', 'Castor', 'Jaguar', 'Cangur', 'Zebra', 'Caracatita',
];

export const WORDS = [
  'Turbo', 'Ninja', 'Pixel', 'Laser', 'Fulger', 'Meteor', 'Robot', 'Vortex', 'Nitro', 'Glitch',
  'Byte', 'Neon', 'Radar', 'Cosmos', 'Magnet', 'Tornado', 'Galaxie', 'Comet', 'Rocket', 'Zoom',
];

export const USERNAME_RE = /^[A-Z][a-z]+[A-Z][a-z]+\d{2}$/;

export function generateName(rng: Rng = secureRandom): string {
  return `${pick(rng, CREATURES)}${pick(rng, WORDS)}${randomInt(rng, 10, 99)}`;
}

/** Up to `count` distinct candidate names, none in `exclude` (case-insensitive). */
export function generateCandidates(count: number, exclude: Set<string>, rng: Rng = secureRandom): string[] {
  const out: string[] = [];
  const seen = new Set([...exclude].map((s) => s.toLowerCase()));
  for (let tries = 0; out.length < count && tries < 1000; tries++) {
    const n = generateName(rng);
    if (seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}
