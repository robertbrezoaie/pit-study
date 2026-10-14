import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { copy, NAME_REACTION_FALLBACKS, profileQuestions, surveyPreferred } from '@/lib/copy';

// Acceptance 13: learner-facing text matches the copy table in spec section 5.3.
const spec = readFileSync('docs/Report5_PartB_Build_Spec.md', 'utf8');
const table = new Map<string, string>();
for (const m of spec.matchAll(/^\| `([a-z_.]+)` \| (.+?) \|$/gm)) table.set(m[1], m[2].trim());

describe('acceptance 13 – UI copy matches the spec', () => {
  it('found the spec copy table', () => {
    expect(table.size).toBeGreaterThan(50);
  });

  it('every simple key is word-for-word identical', () => {
    for (const [key, text] of Object.entries(copy)) {
      if (Array.isArray(text)) continue;
      expect(table.get(key), key).toBe(text);
    }
  });

  it('scale end labels match', () => {
    expect(table.get('rating.ends')).toBe(copy['rating.ends'].join(' … '));
    expect(table.get('survey.ends')).toBe(copy['survey.ends'].join(' … '));
  });

  it('profile and survey questions with their options match', () => {
    const check = (key: string, label: string, options: { label: string }[], sep: string) =>
      expect(table.get(key), key).toBe(`${label} — ${options.map((o) => o.label).join(sep)}`);
    check('profile.grade', profileQuestions.grade.label, profileQuestions.grade.options, ', ');
    check('profile.age', profileQuestions.ageBand.label, profileQuestions.ageBand.options, ', ');
    check('profile.gender', profileQuestions.gender.label, profileQuestions.gender.options, ', ');
    check('profile.prior', profileQuestions.prior.label, profileQuestions.prior.options, ', ');
    check('profile.setting', profileQuestions.setting.label, profileQuestions.setting.options, ', ');
    check('survey.preferred', surveyPreferred.label, surveyPreferred.options, '; ');
  });

  it('name reaction fallback lines match spec 10.3', () => {
    for (const line of NAME_REACTION_FALLBACKS) expect(spec).toContain(`- ${line}`);
    expect(NAME_REACTION_FALLBACKS.length).toBe(8);
  });
});
