// Types shared by the server and the learner UI.

export const ARMS = ['plain', 'hint', 'example'] as const;
export type Arm = (typeof ARMS)[number];

export const DOMAINS = ['algorithms', 'data', 'worlds', 'web', 'ai'] as const;
export type Domain = (typeof DOMAINS)[number];

export const TIERS = ['warmup', 'easy', 'hard'] as const;
export type Tier = (typeof TIERS)[number];

export type Band = 'lower' | 'upper';

export type SessionStep = 'question' | 'correct' | 'feedback' | 'explanation' | 'survey' | 'done';

export type ClientState =
  | { step: 'start' }
  | { step: 'name' }
  | { step: 'profile'; username: string; reaction: string | null }
  | {
      step: SessionStep;
      username: string;
      index: number; // 0-based
      total: number;
      isTest: boolean;
      question: { id: string; prompt: string } | null;
      /** explanation step only */
      explanation?: string;
      /** explanation step only: 'success' | 'fail' | null (no result line) */
      result?: 'success' | 'fail' | null;
      /** explanation step only: whether the helpfulness rating is offered */
      showRating?: boolean;
    };

export interface FeedbackPayload {
  kind: Arm;
  text?: string;
}
