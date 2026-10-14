import { env } from '../env';
import { anthropicCall } from './anthropic';
import { openaiCompatibleCall } from './openaiCompatible';
import { mockCall } from './mock';

export type LlmPurpose = 'grade' | 'hint' | 'example' | 'name_reaction';

export interface LlmRequest {
  purpose: LlmPurpose;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface LlmResult {
  ok: boolean;
  text: string | null; // raw model output
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: 'timeout' | 'http' | 'other';
  /** HTTP status of a failed provider response (401, 429, ...), for alerts. */
  httpStatus?: number;
  /** Parameters actually sent to the provider (logged; some models reject temperature). */
  sentParams?: Record<string, unknown>;
}

export interface LlmProvider {
  name: string;
  call(req: LlmRequest, model: string): Promise<LlmResult>;
}

/** Spec 3.3 settings per purpose. */
export const PURPOSE_SETTINGS: Record<LlmPurpose, { temperature: number; maxTokens: number; timeoutMs: number }> = {
  grade: { temperature: 0, maxTokens: 300, timeoutMs: 12_000 },
  hint: { temperature: 0.4, maxTokens: 400, timeoutMs: 15_000 },
  example: { temperature: 0.4, maxTokens: 400, timeoutMs: 15_000 },
  name_reaction: { temperature: 0.9, maxTokens: 160, timeoutMs: 6_000 },
};

export function getProvider(): LlmProvider {
  switch (env.llmProvider) {
    case 'anthropic':
      return { name: 'anthropic', call: anthropicCall };
    case 'openai_compatible':
      return { name: 'openai_compatible', call: openaiCompatibleCall };
    case 'mock':
      return { name: 'mock', call: mockCall };
  }
}

export function modelFor(purpose: LlmPurpose): string {
  return purpose === 'grade' ? env.graderModel : env.tutorModel;
}
