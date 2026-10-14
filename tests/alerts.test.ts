import { describe, expect, it } from 'vitest';
import { alertMessage, classifyHttpStatus } from '@/lib/alerts';

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
