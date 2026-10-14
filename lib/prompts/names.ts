// Name reaction prompt, keyed by PROMPT_VERSION (spec 10.3).

export const NAME_REACTION: Record<string, (username: string) => string> = {
  v1: (username) =>
    `A child in a Romanian technology class chose the player name "${username}". Write one or two short, warm, funny sentences in Romanian (at most 30 words in total) reacting to the name, like a friendly game host. Use correct Romanian spelling and grammar, with diacritics (ă, â, î, ș, ț). No scores, no ratings, no comparisons, nothing about appearance, nothing that could embarrass anyone. Return only JSON: {"text": "..."}`,
};

export function nameReactionPrompt(version: string, username: string): string {
  const f = NAME_REACTION[version];
  if (!f) throw new Error(`No name reaction prompt for PROMPT_VERSION=${version}`);
  return f(username);
}
