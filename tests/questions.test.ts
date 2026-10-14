import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateBank } from '@/lib/questionSchema';

const raw = JSON.parse(readFileSync('seed/questions.json', 'utf8')) as Record<string, unknown>[];

describe('acceptance 16 – question bank import validation', () => {
  it('seed/questions.json validates: 62 questions', () => {
    const bank = validateBank(raw);
    expect(bank.length).toBe(62);
    const tiers = bank.reduce<Record<string, number>>((m, q) => ({ ...m, [q.tier]: (m[q.tier] ?? 0) + 1 }), {});
    expect(tiers).toEqual({ warmup: 10, easy: 26, hard: 26 });
  });

  it('rejects an unknown domain', () => {
    const bad = structuredClone(raw);
    bad[0].domain = 'music';
    expect(() => validateBank(bad)).toThrow();
  });

  it('rejects an unknown tier', () => {
    const bad = structuredClone(raw);
    bad[0].tier = 'medium';
    expect(() => validateBank(bad)).toThrow();
  });

  it('rejects duplicate ids and duplicate misconception tags', () => {
    expect(() => validateBank([...raw, raw[0]])).toThrow(/Duplicate/);
    const bad = structuredClone(raw);
    (bad[1].misconceptions as { tag: string }[])[0].tag = (raw[0].misconceptions as { tag: string }[])[0].tag;
    expect(() => validateBank(bad)).toThrow(/misconception/);
  });

  it('rejects an id that does not match its domain and tier', () => {
    const bad = structuredClone(raw);
    bad[0].tier = 'hard'; // ALG-W1 marked hard
    expect(() => validateBank(bad)).toThrow(/does not match/);
  });
});
