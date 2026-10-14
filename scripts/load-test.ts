import './loadEnv';

// Spec 15.2: N parallel learners (default 30) complete a full test session (?test=1) against a
// running server. Default target: http://localhost:3000. Start the server with LLM_PROVIDER=mock
// for the default mock run; point it at a server using the real LLM for the one real run.
// Usage: npm run load-test [-- --base https://... --n 30] [--pace 150]
// --pace S: behave like real children, about S seconds per question (thinking and typing time),
// with starts spread over the first minute. Use it with the real LLM, whose rate limit is per
// minute: an unpaced run makes far more calls per minute than a real class.
// Example for one class: npm run load-test -- --base https://<domain> --n 12 --pace 150

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const BASE = arg('base', process.env.LOAD_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const N = Number(arg('n', '30'));
const TOKEN = process.env.STUDY_TOKEN ?? '';
// --no-test: local verification against the in-memory dev DB only (creates non-test sessions). Never use on the real study.
const TEST = !process.argv.includes('--no-test');
const PACE_MS = Number(arg('pace', '0')) * 1000;
const think = (share: number) =>
  PACE_MS ? new Promise((r) => setTimeout(r, share * PACE_MS * (0.5 + Math.random()))) : Promise.resolve();
let graderFallbacks = 0;
let retryFallbacks = 0;

const CANNED = [
  { text: 'nu stiu exact' }, // short -> usually wrong
  { text: 'cred ca e ceva cu bucla' },
  { dontKnow: true, text: '' },
  { text: 'pentru ca programul verifica o conditie si apoi face actiunea, iar daca nu e adevarata nu face nimic, deci merge altfel' },
  { text: 'se repeta automat si codul e mai scurt, mai usor de schimbat si cu mai putine greseli de scris' },
];

const timings: Record<string, number[]> = { answer: [], feedback: [], retry: [] };
let fiveXX = 0;
let otherErrors = 0;

class Learner {
  jar = new Map<string, string>();

  async call(path: string, body?: unknown): Promise<{ status: number; json: any; ms: number }> {
    const started = Date.now();
    const res = await fetch(BASE + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '),
        'user-agent': 'pit-load-test',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a) || /expires=thu, 01 jan 1970/i.test(a));
      if (!value || expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const ms = Date.now() - started;
    const json = await res.json().catch(() => null);
    if (res.status >= 500) fiveXX++;
    else if (res.status >= 400 && res.status !== 409) otherErrors++;
    if (res.status >= 400) console.error(`  ${res.status} ${path} ${JSON.stringify(json)}`);
    return { status: res.status, json, ms };
  }

  async run(i: number): Promise<boolean> {
    const pickAnswer = () => CANNED[Math.floor(Math.random() * CANNED.length)];
    if (PACE_MS) await new Promise((r) => setTimeout(r, Math.random() * 60_000));
    if ((await this.call('/api/start', { token: TOKEN, assent: true, test: TEST })).status !== 200) return false;
    const names = (await this.call('/api/names')).json?.names as string[] | undefined;
    if (!names?.length) return false;
    if ((await this.call('/api/participant', { mode: 'new', username: names[0] })).status !== 200) return false;
    await this.call('/api/name-reaction', {});
    const profile = { grade: 4 + (i % 9), ageBand: '12-13', gender: 'undisclosed', prior: 'no', setting: 'home', browserPrior: false };
    let st = (await this.call('/api/session/start', profile)).json;

    for (let guard = 0; guard < 100; guard++) {
      const qid = st?.question?.id;
      switch (st?.step) {
        case 'question': {
          await think(0.7);
          const r = await this.call('/api/answer', { questionId: qid, ...pickAnswer() });
          timings.answer.push(r.ms);
          if (r.json?.outcome === 'grader_failed') graderFallbacks++;
          st = r.json?.state ?? r.json;
          break;
        }
        case 'correct':
          st = (await this.call('/api/next', { questionId: qid })).json;
          break;
        case 'feedback': {
          const f = await this.call('/api/feedback', { questionId: qid });
          timings.feedback.push(f.ms);
          await think(0.3);
          const r = await this.call('/api/retry', { questionId: qid, ...pickAnswer() });
          timings.retry.push(r.ms);
          if (r.json && r.json.success === null) retryFallbacks++;
          st = r.json?.state ?? r.json;
          break;
        }
        case 'explanation':
          st = st.showRating
            ? (await this.call('/api/rating', { questionId: qid, helpful: Math.random() < 0.3 ? null : 1 + Math.floor(Math.random() * 5) })).json
            : (await this.call('/api/next', { questionId: qid })).json;
          break;
        case 'survey':
          st = (await this.call('/api/survey', { preferredHelp: 'hint', fair: 4, understood: 3, wantAgain: 5 })).json;
          break;
        case 'done':
          await this.call('/api/logout', {});
          return true;
        default:
          // 409 bodies carry the state; anything else: re-read it
          st = st?.state ?? (await this.call('/api/session/state')).json;
      }
    }
    return false;
  }
}

function p95(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}

async function main() {
  if (!TOKEN) throw new Error('STUDY_TOKEN is not set');
  console.log(`Load test: ${N} learners against ${BASE}`);
  const started = Date.now();
  const done = await Promise.all(Array.from({ length: N }, (_, i) => new Learner().run(i).catch((e) => (console.error(e), false))));
  const completed = done.filter(Boolean).length;
  const graderP95 = p95([...timings.answer, ...timings.retry]);
  const tutorP95 = p95(timings.feedback);
  console.log(`\nCompleted sessions: ${completed}/${N} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`Requests: answer ${timings.answer.length}, feedback ${timings.feedback.length}, retry ${timings.retry.length}`);
  console.log(`p95 grader route (answer + retry): ${graderP95} ms   (limit 8000)`);
  console.log(`p95 tutor route (feedback, incl. 1.5 s minimum): ${tutorP95} ms   (limit 10000)`);
  console.log(`5xx responses: ${fiveXX}; other 4xx (not 409): ${otherErrors}`);
  console.log(`Grader fallbacks shown to learners: first answers ${graderFallbacks}, retries ${retryFallbacks}`);
  console.log('Tutor fallbacks are invisible here: check Q4 (llm_calls by status) and decisions.tutor_status.');
  const pass = fiveXX === 0 && completed === N && graderP95 < 8000 && tutorP95 < 10000 && graderFallbacks + retryFallbacks === 0;
  console.log(pass ? '\nPASS' : '\nFAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
