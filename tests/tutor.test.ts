import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentWords, isLeaky, leakageRatio } from '@/lib/leakage';
import { generateCandidates, generateName, USERNAME_RE } from '@/lib/names';

describe('spec 9.4 – leakage guard', () => {
  const ref = 'Bucla se oprește prea devreme: condiția este i < 100 în loc de i <= 100, range(1, 100) în loc de range(1, 101).';

  it('content words: lowercase, no diacritics, 4+ letters, no stopwords', () => {
    const w = contentWords('Bucla se oprește PREA devreme pentru că condiția este greșită');
    expect([...w].sort()).toEqual(['bucla', 'conditia', 'devreme', 'gresita', 'opreste', 'prea'].sort());
  });

  it('flags texts that reuse more than half of the reference content words', () => {
    expect(isLeaky(ref, 'Bucla se oprește prea devreme, condiția trebuie schimbată ca range să includă 100.')).toBe(true);
    expect(isLeaky(ref, 'Gândește-te: ce număr ar trebui să fie ultimul afișat? Verifică ultima repetare.')).toBe(false);
    expect(leakageRatio('', 'orice')).toBe(0);
  });

  it('regenerates once when the first text leaks, and reports regenerated_ok', async () => {
    const texts = [
      '{"text": "Bucla se oprește prea devreme, condiția range trebuie schimbată."}',
      '{"text": "Gândește-te ce număr ar trebui afișat ultimul."}',
    ];
    vi.resetModules();
    vi.doMock('@/lib/llm/adapter', async (orig) => ({
      ...(await orig<typeof import('@/lib/llm/adapter')>()),
      getProvider: () => ({ name: 'fake', call: async () => ({ ok: true, text: texts.shift()!, latencyMs: 5 }) }),
      modelFor: () => 'fake',
    }));
    const { generateFeedback } = await import('@/lib/tutor');
    const users: string[] = [];
    const res = await generateFeedback({
      kind: 'hint',
      question: {
        id: 'ALG-H1', tier: 'hard', version: 1, prompt_ro: 'p', reference_answer_ro: ref,
        rubric: { '0': 'a', '1': 'b', '2': 'c', '3': 'd' }, misconceptions: [], explanation_ro: 'e',
      },
      firstAnswer: 'nu stiu',
      misconception: null,
      band: 'lower',
      promptVersion: 'v1',
      log: async (r) => (users.push(r.request.user as string), null),
    });
    expect(res.status).toBe('regenerated_ok');
    expect(users[1]).toMatch(/revealed too much of the answer/);
  });

  afterEach(() => vi.resetModules());
});

describe('spec 10.1 – usernames', () => {
  it('generated names match the accepted pattern and contain no diacritics', () => {
    for (let i = 0; i < 2000; i++) {
      const n = generateName();
      expect(n).toMatch(USERNAME_RE);
      expect(n).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it('candidates are distinct and skip excluded names case-insensitively', () => {
    const c = generateCandidates(3, new Set(['pandaninja42']));
    expect(new Set(c).size).toBe(3);
    expect(c.map((x) => x.toLowerCase())).not.toContain('pandaninja42');
  });
});
