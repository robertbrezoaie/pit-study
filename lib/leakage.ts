// Spec 9.4: does the tutor text reveal too much of the reference answer?

const STOPWORDS = new Set(
  [
    'acea', 'aceea', 'acel', 'acela', 'acele', 'acest', 'acesta', 'aceasta', 'aceste', 'acestea', 'acestui',
    'acolo', 'acum', 'adica', 'altfel', 'apoi', 'asta', 'astfel', 'atunci', 'avea', 'aveti', 'cand', 'care',
    'catre', 'ceea', 'cele', 'celor', 'chiar', 'cine', 'cinci', 'daca', 'deci', 'deja', 'despre', 'dintr',
    'dintre', 'doar', 'dupa', 'este', 'esti', 'fara', 'fiecare', 'fost', 'foarte', 'inainte', 'intr',
    'intre', 'lucru', 'lucruri', 'mereu', 'mult', 'multe', 'multi', 'noastre', 'nostru', 'orice', 'pana',
    'pentru', 'poate', 'poti', 'prin', 'sunt', 'spre', 'tale', 'tine', 'toate', 'totul', 'tocmai', 'trebuie',
    'unde', 'unei', 'unor', 'unui', 'unul', 'vreo', 'exemplu', 'exemple', 'adica', 'altul', 'alta', 'alte',
    'dacă', 'face', 'faci', 'fiind', 'avem', 'aveai', 'acela', 'ceva', 'nimic', 'niste', 'nici', 'iar',
  ].map(normalize),
);

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function contentWords(text: string): Set<string> {
  const words = normalize(text).split(/[^a-z]+/);
  return new Set(words.filter((w) => w.length >= 4 && !STOPWORDS.has(w)));
}

/** Share of the reference answer's content words that also appear in the tutor text. */
export function leakageRatio(referenceAnswer: string, tutorText: string): number {
  const ref = contentWords(referenceAnswer);
  if (ref.size === 0) return 0;
  const out = contentWords(tutorText);
  let hit = 0;
  for (const w of ref) if (out.has(w)) hit++;
  return hit / ref.size;
}

export const LEAK_THRESHOLD = 0.5;

export function isLeaky(referenceAnswer: string, tutorText: string): boolean {
  return leakageRatio(referenceAnswer, tutorText) > LEAK_THRESHOLD;
}
