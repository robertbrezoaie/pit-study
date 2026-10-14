import { describe, expect, it } from 'vitest';
import { alertMessage, classifyHttpStatus } from '@/lib/alerts';
import { crossedThreshold, estimateCost } from '@/lib/budget';

describe('LLM outage alerts', () => {
  it('classifies provider HTTP errors', () => {
    expect(classifyHttpStatus(429)).toBe('llm_rate');
    expect(classifyHttpStatus(402)).toBe('llm_quota');
    expect(classifyHttpStatus(401)).toBe('llm_auth');
    expect(classifyHttpStatus(403)).toBe('llm_auth');
    expect(classifyHttpStatus(500)).toBeNull();
    expect(classifyHttpStatus(undefined)).toBeNull();
  });

  it('messages carry counts and codes only, in Romanian', () => {
    const m = alertMessage('llm_rate', { purpose: 'grade', model: 'ministral-14b-2512', status: 'error', httpStatus: 429 }, 7);
    expect(m.title).toContain('429');
    expect(m.message).toContain('7 apeluri eșuate');
    expect(m.message).toContain('Limits');
  });
});

describe('monthly budget alert', () => {
  it('estimates cost from token counts and per-million prices', () => {
    const rows = [{ model: 'm', calls: 10, input_tokens: 1_000_000, output_tokens: 200_000 }];
    expect(estimateCost(rows, 1.5, 7.5)).toBeCloseTo(3.0, 6);
  });
  it('returns the highest threshold reached', () => {
    expect(crossedThreshold(5, 12.75)).toBeNull();
    expect(crossedThreshold(6.4, 12.75)).toBe(0.5);
    expect(crossedThreshold(10.3, 12.75)).toBe(0.8);
    expect(crossedThreshold(12.2, 12.75)).toBe(0.95);
    expect(crossedThreshold(20, 12.75)).toBe(0.95);
  });
});
