/** Coarse device type from the user agent; only this word is stored (rule 7). */
export function deviceFromUserAgent(ua: string | null): 'desktop' | 'mobile' | 'tablet' {
  if (!ua) return 'desktop';
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return 'mobile';
  return 'desktop';
}
