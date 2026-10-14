// Server-side configuration. Read lazily so scripts and tests can load modules without a full env.

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error(`Env ${name} is not a number: ${raw}`);
  return v;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') throw new Error(`Missing env ${name}`);
  return v.trim();
}

export type LlmProviderName = 'anthropic' | 'openai_compatible' | 'mock';

export const env = {
  get supabaseUrl() {
    return req('SUPABASE_URL');
  },
  get supabaseKey() {
    return req('SUPABASE_SERVICE_ROLE_KEY');
  },
  get llmProvider(): LlmProviderName {
    const p = (process.env.LLM_PROVIDER ?? 'anthropic').trim();
    if (p !== 'anthropic' && p !== 'openai_compatible' && p !== 'mock') {
      throw new Error(`Unknown LLM_PROVIDER ${p}`);
    }
    return p;
  },
  get llmApiKey() {
    return process.env.LLM_API_KEY?.trim() ?? '';
  },
  get llmBaseUrl() {
    return process.env.LLM_BASE_URL?.trim() ?? '';
  },
  get llmJsonMode() {
    return /^(1|true|yes)$/i.test(process.env.LLM_JSON_MODE?.trim() ?? '');
  },
  get graderModel() {
    return process.env.LLM_MODEL_GRADER?.trim() || (this.llmProvider === 'mock' ? 'mock' : req('LLM_MODEL_GRADER'));
  },
  get tutorModel() {
    return process.env.LLM_MODEL_TUTOR?.trim() || (this.llmProvider === 'mock' ? 'mock' : req('LLM_MODEL_TUTOR'));
  },
  get studyToken() {
    return req('STUDY_TOKEN');
  },
  get openFrom(): Date | null {
    const v = process.env.STUDY_OPEN_FROM?.trim();
    return v ? new Date(v) : null;
  },
  get openUntil(): Date | null {
    const v = process.env.STUDY_OPEN_UNTIL?.trim();
    return v ? new Date(v) : null;
  },
  get cookieSecret() {
    const s = req('COOKIE_SECRET');
    if (s.length < 32) throw new Error('COOKIE_SECRET must be at least 32 characters');
    return s;
  },
  get randomShare() {
    const v = num('RANDOM_SHARE', 0.5);
    if (v < 0 || v > 1) throw new Error('RANDOM_SHARE must be in [0,1]');
    return v;
  },
  get nQuestions() {
    const v = num('N_QUESTIONS', 12);
    if (v !== 10 && v !== 12) throw new Error('N_QUESTIONS must be 10 or 12');
    return v;
  },
  get ratingSampleP() {
    return num('RATING_SAMPLE_P', 0.25);
  },
  get promptVersion() {
    return process.env.PROMPT_VERSION?.trim() || 'v1';
  },
  get appVersion() {
    return (
      process.env.APP_VERSION?.trim() ||
      process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 12) ||
      'dev'
    );
  },
};

/** True when the study link accepts answers right now (test sessions ignore this). */
export function isStudyOpen(now = new Date()): boolean {
  const from = env.openFrom;
  const until = env.openUntil;
  if (!from || !until || isNaN(from.getTime()) || isNaN(until.getTime())) return false;
  return now >= from && now <= until;
}
