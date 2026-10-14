'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { copy, EMOJI_SCALE, fill, NAME_REACTION_FALLBACKS, profileQuestions, surveyPreferred } from '@/lib/copy';
import type { ClientState, FeedbackPayload, SessionStep } from '@/lib/types';
import BrandShell from './BrandShell';

// ---------- types and API helper ----------

type SessionState = Extract<ClientState, { index: number }>;

type View =
  | { kind: 'boot' }
  | { kind: 'closed' }
  | { kind: 'start'; resumeUser?: string; resumeState?: SessionState }
  | { kind: 'name' }
  | { kind: 'profile'; username: string; reaction: string | null }
  | { kind: 'session'; state: SessionState }
  | { kind: 'error' };

const SESSION_STEPS: SessionStep[] = ['question', 'correct', 'feedback', 'explanation', 'survey', 'done'];
const isSession = (s: ClientState): s is SessionState => SESSION_STEPS.includes(s.step as SessionStep);

class ApiError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown> | null,
  ) {
    super(`api ${status}`);
  }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}

// Per-viewer storage helpers: never let a blocked storage break the flow.
const ACTIVE_KEY = 'pit_active';
const DONE_KEY = 'pit_done';
function store(kind: 'session' | 'local', key: string, value: string | null) {
  try {
    const s = kind === 'session' ? window.sessionStorage : window.localStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {}
}
function read(kind: 'session' | 'local', key: string): string | null {
  try {
    return (kind === 'session' ? window.sessionStorage : window.localStorage).getItem(key);
  } catch {
    return null;
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- root ----------

export default function StudyApp({ token, test }: { token: string; test: boolean }) {
  const [view, setView] = useState<View>({ kind: 'boot' });

  const boot = useCallback(async () => {
    try {
      const st = await api<ClientState | { closed: true }>('/api/session/state');
      if ('closed' in st) return setView({ kind: 'closed' });
      const active = read('session', ACTIVE_KEY) === '1';
      if (isSession(st)) {
        if (active) return setView({ kind: 'session', state: st });
        // A new visit on a browser with an unfinished session: computers may be shared.
        if (st.step !== 'done') return setView({ kind: 'start', resumeUser: st.username, resumeState: st });
        return setView({ kind: 'start' });
      }
      if (active && st.step === 'name') return setView({ kind: 'name' });
      if (active && st.step === 'profile') return setView({ kind: 'profile', username: st.username, reaction: st.reaction });
      setView({ kind: 'start' });
    } catch {
      setView({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  /** Shared error policy: 409 re-renders from the server state, closed shows the closed page. */
  const onError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) {
        const st = err.body?.state as ClientState | undefined;
        if (err.status === 409 && st && isSession(st)) return setView({ kind: 'session', state: st });
        if (err.body?.closed) return setView({ kind: 'closed' });
        if (err.status === 401) return void boot();
      }
      setView({ kind: 'error' });
    },
    [boot],
  );

  const toSession = (state: ClientState) => {
    if (isSession(state)) setView({ kind: 'session', state });
    else void boot();
  };

  const signOut = async () => {
    store('session', ACTIVE_KEY, null);
    try {
      await api('/api/logout', {});
    } catch {}
    setView({ kind: 'start' });
  };

  return (
    <BrandShell
      badge={test ? <span className="rounded bg-sun px-2 py-0.5 text-xs font-extrabold tracking-wider text-ink">TEST</span> : undefined}
    >
      {view.kind === 'boot' && <Loading text="" />}
      {view.kind === 'closed' && <p className="mt-16 text-center text-[22px]">{copy['closed.text']}</p>}
      {view.kind === 'error' && <ErrorBox onRetry={() => void boot()} />}
      {view.kind === 'start' && (
        <StartScreen
          resumeUser={view.resumeUser}
          onResume={() => {
            store('session', ACTIVE_KEY, '1');
            if (view.resumeState) setView({ kind: 'session', state: view.resumeState });
          }}
          onNotMe={signOut}
          onStart={async () => {
            try {
              const r = await api<{ ok?: true; closed?: true }>('/api/start', { token, assent: true, test });
              if (r.closed) return setView({ kind: 'closed' });
              store('session', ACTIVE_KEY, '1');
              setView({ kind: 'name' });
            } catch (e) {
              onError(e);
            }
          }}
        />
      )}
      {view.kind === 'name' && (
        <NameScreen onError={onError} onContinue={(username, reaction) => setView({ kind: 'profile', username, reaction })} />
      )}
      {view.kind === 'profile' && <ProfileScreen onError={onError} onStarted={toSession} />}
      {view.kind === 'session' && (
        <SessionView
          key={`${view.state.step}-${view.state.index}`}
          state={view.state}
          onState={toSession}
          onError={onError}
          onDone={async () => {
            await signOut();
          }}
        />
      )}
    </BrandShell>
  );
}

// ---------- shared UI ----------

function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'link';
  type?: 'button' | 'submit';
}) {
  const base = 'min-h-12 rounded-lg px-6 text-[18px] font-bold transition disabled:cursor-not-allowed disabled:opacity-45';
  const styles = {
    primary: 'bg-brand text-brand-ink hover:brightness-110',
    secondary: 'border-2 border-line bg-card text-ink hover:border-brand',
    link: 'px-2 text-brand underline underline-offset-4',
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      {children}
    </button>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="mt-20 flex flex-col items-center gap-5" role="status" aria-live="polite">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-soft border-t-brand-bright" />
      {text && <p className="text-[20px] text-muted">{text}</p>}
    </div>
  );
}

function ErrorBox({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-6 text-center">
      <p className="text-[20px]">{copy['error.generic']}</p>
      <Button onClick={onRetry}>{copy['error.retry']}</Button>
    </div>
  );
}

function Progress({ index, total }: { index: number; total: number }) {
  return (
    <div className="mb-6">
      <p className="mb-2 text-[16px] font-semibold text-muted">{fill(copy['q.progress'], { n: index + 1, N: total })}</p>
      <div className="h-2 w-full overflow-hidden rounded-full bg-brand-soft">
        <div className="h-full rounded-full bg-brand-bright" style={{ width: `${((index + 1) / total) * 100}%` }} />
      </div>
    </div>
  );
}

function AnswerBox({
  value,
  onChange,
  placeholder,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onSubmit: () => void;
  disabled: boolean;
}) {
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 600))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (!disabled && value.trim()) onSubmit();
          }
        }}
        maxLength={600}
        rows={5}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full resize-y rounded-xl border-2 border-line bg-card p-4 text-[18px] outline-none focus:border-brand focus-visible:outline-none disabled:opacity-60"
      />
      <p className="mt-1 text-right text-[14px] text-muted">{value.length}/600</p>
    </div>
  );
}

function Choice({
  options,
  value,
  onChange,
  columns = false,
}: {
  options: { label: string; value: string | number | null }[];
  value: string | number | null | undefined;
  onChange: (v: string | number | null) => void;
  columns?: boolean;
}) {
  return (
    <div className={columns ? 'grid grid-cols-2 gap-2 sm:grid-cols-3' : 'flex flex-wrap gap-2'} role="radiogroup">
      {options.map((o) => {
        const on = value !== undefined && o.value === value;
        return (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`min-h-12 rounded-xl border-2 px-4 text-[17px] font-semibold transition ${
              on ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-card hover:border-brand'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function EmojiScale({
  value,
  onChange,
  ends,
  label,
}: {
  value: number | null;
  onChange: (v: number) => void;
  ends: readonly [string, string] | readonly string[];
  label: string;
}) {
  return (
    <div>
      <div className="flex justify-between gap-1 sm:justify-start sm:gap-3" role="radiogroup" aria-label={label}>
        {EMOJI_SCALE.map((e, i) => {
          const v = i + 1;
          const on = value === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={String(v)}
              onClick={() => onChange(v)}
              className={`flex h-14 w-14 items-center justify-center rounded-full border-2 text-[30px] transition ${
                on ? 'border-brand bg-brand-soft scale-110' : 'border-transparent hover:border-line'
              }`}
            >
              {e}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[14px] text-muted sm:max-w-[22rem]">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
    </div>
  );
}

// ---------- 1. Start ----------

function StartScreen({
  resumeUser,
  onResume,
  onNotMe,
  onStart,
}: {
  resumeUser?: string;
  onResume: () => void;
  onNotMe: () => void;
  onStart: () => Promise<void>;
}) {
  const [assent, setAssent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (resumeUser) {
    return (
      <main className="mt-12 flex flex-col gap-8">
        <h1 className="text-[28px] leading-tight font-extrabold text-brand">{fill(copy['start.resume'], { username: resumeUser })}</h1>
        <div className="flex flex-wrap gap-3">
          <Button onClick={onResume}>{copy['start.resume_yes']}</Button>
          <Button variant="secondary" onClick={onNotMe}>
            {copy['start.resume_no']}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="mt-8 flex flex-col gap-6">
      <h1 className="text-[28px] leading-tight font-extrabold text-brand sm:text-[37px]">{copy['start.title']}</h1>
      <p className="text-[18px]">{copy['start.info']}</p>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border-2 border-line bg-card px-4 py-3">
        <input type="checkbox" checked={assent} onChange={(e) => setAssent(e.target.checked)} className="h-6 w-6 accent-brand" />
        <span className="font-semibold">{copy['start.assent']}</span>
      </label>
      <div>
        <Button
          disabled={!assent || busy}
          onClick={async () => {
            setBusy(true);
            await onStart();
            setBusy(false);
          }}
        >
          {copy['start.button']}
        </Button>
      </div>
    </main>
  );
}

// ---------- 2. Name ----------

function NameScreen({
  onContinue,
  onError,
}: {
  onContinue: (username: string, reaction: string | null) => void;
  onError: (e: unknown) => void;
}) {
  const [names, setNames] = useState<string[] | null>(null);
  const [haveMode, setHaveMode] = useState(false);
  const [typed, setTyped] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [reaction, setReaction] = useState<string | null>(null);

  const loadNames = useCallback(async () => {
    setNames(null);
    try {
      setNames((await api<{ names: string[] }>('/api/names')).names);
    } catch (e) {
      onError(e);
    }
  }, [onError]);

  useEffect(() => {
    void loadNames();
  }, [loadNames]);

  const choose = async (mode: 'new' | 'existing', username: string) => {
    setBusy(true);
    setNotFound(false);
    try {
      const r = await api<{ username: string }>('/api/participant', { mode, username });
      setChosen(r.username);
      // Non-blocking reaction line, with a fallback after 6 s.
      const fallback = NAME_REACTION_FALLBACKS[Math.floor(Math.random() * NAME_REACTION_FALLBACKS.length)];
      const timer = setTimeout(() => setReaction((cur) => cur ?? fallback), 6500);
      api<{ text: string }>('/api/name-reaction', {})
        .then((x) => setReaction((cur) => cur ?? x.text))
        .catch(() => setReaction((cur) => cur ?? fallback))
        .finally(() => clearTimeout(timer));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else if (e instanceof ApiError && (e.status === 409 || e.status === 400)) void loadNames();
      else onError(e);
    } finally {
      setBusy(false);
    }
  };

  if (chosen) {
    return (
      <main className="mt-12 flex flex-col items-center gap-6 text-center">
        <p className="text-[26px] font-extrabold whitespace-nowrap text-brand min-[400px]:text-[30px] sm:text-[37px]">{chosen}</p>
        <p className="min-h-[3em] text-[20px] text-muted" aria-live="polite">
          {reaction ?? ''}
        </p>
        <Button onClick={() => onContinue(chosen, reaction)}>{copy['name.continue']}</Button>
      </main>
    );
  }

  return (
    <main className="mt-6 flex flex-col gap-5">
      <h1 className="text-[28px] leading-tight font-extrabold text-brand">{copy['name.title']}</h1>
      {!haveMode ? (
        <>
          <p>{copy['name.hint']}</p>
          <div className="flex flex-col gap-3">
            {names === null ? (
              <Loading text="" />
            ) : (
              names.map((n) => (
                <button
                  key={n}
                  disabled={busy}
                  onClick={() => void choose('new', n)}
                  className="min-h-16 rounded-xl border-2 border-line bg-card px-5 text-left text-[21px] font-bold whitespace-nowrap transition sm:text-[24px] hover:border-brand disabled:opacity-50"
                >
                  {n}
                </button>
              ))
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" disabled={busy || names === null} onClick={() => void loadNames()}>
              {copy['name.more']}
            </Button>
            <Button variant="link" onClick={() => setHaveMode(true)}>
              {copy['name.have']}
            </Button>
          </div>
        </>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) void choose('existing', typed.trim());
          }}
        >
          <label className="flex flex-col gap-2">
            <span>{copy['name.have_prompt']}</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value.replace(/\s/g, '').slice(0, 40))}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="min-h-12 rounded-xl border-2 border-line bg-card px-4 text-[20px] outline-none focus:border-brand"
            />
          </label>
          {notFound && <p className="border-l-4 border-accent pl-3 font-bold">{copy['name.have_error']}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy || !typed.trim()}>
              {copy['name.continue']}
            </Button>
            <Button
              variant="link"
              onClick={() => {
                setHaveMode(false);
                setNotFound(false);
              }}
            >
              {copy['name.more']}
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}

// ---------- 3. Profile ----------

function ProfileScreen({ onStarted, onError }: { onStarted: (s: ClientState) => void; onError: (e: unknown) => void }) {
  const [v, setV] = useState<Record<string, string | number | null | undefined>>({});
  const [busy, setBusy] = useState(false);
  const keys = ['grade', 'ageBand', 'gender', 'prior', 'setting'] as const;
  const complete = keys.every((k) => v[k] !== undefined);

  return (
    <main className="mt-6 flex flex-col gap-7">
      <h1 className="text-[28px] leading-tight font-extrabold text-brand">{copy['profile.title']}</h1>
      {keys.map((k) => (
        <fieldset key={k} className="flex flex-col gap-3">
          <legend className="mb-3 text-[19px] font-bold">{profileQuestions[k].label}</legend>
          <Choice
            options={profileQuestions[k].options}
            value={v[k]}
            onChange={(x) => setV((cur) => ({ ...cur, [k]: x }))}
            columns={k === 'grade'}
          />
        </fieldset>
      ))}
      <div>
        <Button
          disabled={!complete || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const st = await api<ClientState>('/api/session/start', {
                grade: v.grade,
                ageBand: v.ageBand,
                gender: v.gender,
                prior: v.prior,
                setting: v.setting,
                browserPrior: read('local', DONE_KEY) === '1',
              });
              onStarted(st);
            } catch (e) {
              onError(e);
              setBusy(false);
            }
          }}
        >
          {copy['profile.start']}
        </Button>
      </div>
    </main>
  );
}

// ---------- 4–9. Session screens ----------

function SessionView({
  state,
  onState,
  onError,
  onDone,
}: {
  state: SessionState;
  onState: (s: ClientState) => void;
  onError: (e: unknown) => void;
  onDone: () => Promise<void>;
}) {
  const q = state.question;
  const post = async (path: string, body: unknown) => {
    try {
      const r = await api<ClientState | { state: ClientState }>(path, body);
      onState('state' in r ? r.state : r);
    } catch (e) {
      onError(e);
    }
  };

  switch (state.step) {
    case 'question':
      return q && <QuestionScreen state={state} onSubmit={(body) => post('/api/answer', { questionId: q.id, ...body })} />;
    case 'correct':
      return (
        q && (
          <main>
            <Progress index={state.index} total={state.total} />
            <div className="mt-10 flex flex-col items-center gap-8 text-center">
              <p className="text-[32px] font-extrabold text-ok">{copy['correct.title']}</p>
              <NextButton onClick={() => post('/api/next', { questionId: q.id })} />
            </div>
          </main>
        )
      );
    case 'feedback':
      return q && <FeedbackScreen state={state} onError={onError} onSubmit={(body) => post('/api/retry', { questionId: q.id, ...body })} />;
    case 'explanation':
      return (
        q && (
          <ExplanationScreen
            state={state}
            onNext={(helpful) =>
              state.showRating ? post('/api/rating', { questionId: q.id, helpful }) : post('/api/next', { questionId: q.id })
            }
          />
        )
      );
    case 'survey':
      return <SurveyScreen onSubmit={(body) => post('/api/survey', body)} />;
    case 'done':
      return <DoneScreen username={state.username} onDone={onDone} />;
  }
}

function NextButton({ onClick }: { onClick: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await onClick();
        setBusy(false);
      }}
    >
      {copy.next}
    </Button>
  );
}

function QuestionScreen({
  state,
  onSubmit,
}: {
  state: SessionState;
  onSubmit: (b: { text?: string; dontKnow?: boolean }) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (b: { text?: string; dontKnow?: boolean }) => {
    setBusy(true);
    await onSubmit(b);
    setBusy(false);
  };
  return (
    <main>
      <Progress index={state.index} total={state.total} />
      <h1 className="mb-5 text-[22px] leading-snug font-bold">{state.question!.prompt}</h1>
      {busy ? (
        <Loading text={copy['q.checking']} />
      ) : (
        <>
          <AnswerBox
            value={text}
            onChange={setText}
            placeholder={copy['q.placeholder']}
            disabled={busy}
            onSubmit={() => void send({ text })}
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <Button disabled={busy || !text.trim()} onClick={() => void send({ text })}>
              {copy['q.submit']}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void send({ text, dontKnow: true })}>
              {copy['q.dontknow']}
            </Button>
          </div>
        </>
      )}
    </main>
  );
}

function FeedbackScreen({
  state,
  onSubmit,
  onError,
}: {
  state: SessionState;
  onSubmit: (b: { text?: string; dontKnow?: boolean }) => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [fb, setFb] = useState<FeedbackPayload | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);
  const qid = state.question!.id;

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    // Same loading screen for every arm, for at least 1.5 s (the server also enforces this).
    Promise.all([api<FeedbackPayload>('/api/feedback', { questionId: qid }), delay(1500)])
      .then(([r]) => setFb(r))
      .catch(onError);
  }, [qid, onError]);

  if (!fb) {
    return (
      <main>
        <Progress index={state.index} total={state.total} />
        <Loading text={copy['mistake.loading']} />
      </main>
    );
  }

  const send = async (b: { text?: string; dontKnow?: boolean }) => {
    setBusy(true);
    await onSubmit(b);
    setBusy(false);
  };

  return (
    <main>
      <Progress index={state.index} total={state.total} />
      <p className="mb-5 text-[24px] font-extrabold">{copy['mistake.title']}</p>
      {fb.kind !== 'plain' && fb.text && (
        // Hint and worked example share exactly the same box; only the label differs (rule 2).
        <section className="mb-6 rounded-r-xl border-l-[6px] border-brand-bright bg-brand-soft p-5">
          <p className="mb-2 text-[16px] font-extrabold tracking-wide text-brand uppercase">
            {fb.kind === 'hint' ? copy['hint.label'] : copy['example.label']}
          </p>
          <p className="text-[18px] whitespace-pre-line">{fb.text}</p>
        </section>
      )}
      <h2 className="mb-4 text-[20px] leading-snug font-bold">{state.question!.prompt}</h2>
      {busy ? (
        <Loading text={copy['q.checking']} />
      ) : (
        <>
          <AnswerBox
            value={text}
            onChange={setText}
            placeholder={copy['retry.placeholder']}
            disabled={busy}
            onSubmit={() => void send({ text })}
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <Button disabled={busy || !text.trim()} onClick={() => void send({ text })}>
              {copy['retry.submit']}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void send({ text, dontKnow: true })}>
              {copy['q.dontknow']}
            </Button>
          </div>
        </>
      )}
    </main>
  );
}

function ExplanationScreen({ state, onNext }: { state: SessionState; onNext: (helpful: number | null) => Promise<void> }) {
  const [rating, setRating] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (helpful: number | null) => {
    setBusy(true);
    await onNext(helpful);
    setBusy(false);
  };
  const graderFailed = state.result === null && !state.showRating;

  return (
    <main>
      <Progress index={state.index} total={state.total} />
      {state.result === 'success' && <p className="mb-5 text-[24px] font-extrabold text-ok">{copy['result.success']}</p>}
      {state.result === 'fail' && <p className="mb-5 text-[22px] font-bold">{copy['result.fail']}</p>}
      {graderFailed && <p className="mb-5 text-[20px] font-bold">{copy['fallback.grader']}</p>}
      <section className="mb-8 rounded-r-xl border-l-[6px] border-sun bg-note/60 p-5">
        <p className="mb-2 text-[16px] font-extrabold tracking-wide text-muted uppercase">{copy['explanation.label']}</p>
        <p className="text-[18px]">{state.explanation}</p>
      </section>
      {state.showRating && (
        <div className="mb-8 flex flex-col gap-3">
          <p className="font-semibold">{copy['rating.question']}</p>
          <EmojiScale value={rating} onChange={setRating} ends={copy['rating.ends']} label={copy['rating.question']} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={() => void go(rating)}>
          {copy.next}
        </Button>
        {state.showRating && (
          <Button variant="link" disabled={busy} onClick={() => void go(null)}>
            {copy.skip}
          </Button>
        )}
      </div>
    </main>
  );
}

function SurveyScreen({ onSubmit }: { onSubmit: (b: unknown) => Promise<void> }) {
  const [preferred, setPreferred] = useState<string | null>(null);
  const [fair, setFair] = useState<number | null>(null);
  const [understood, setUnderstood] = useState<number | null>(null);
  const [wantAgain, setWantAgain] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const complete = preferred && fair && understood && wantAgain;

  const items: [string, number | null, (v: number) => void][] = [
    [copy['survey.fair'], fair, setFair],
    [copy['survey.understood'], understood, setUnderstood],
    [copy['survey.want_again'], wantAgain, setWantAgain],
  ];

  return (
    <main className="mt-4 flex flex-col gap-8">
      <h1 className="text-[28px] leading-tight font-extrabold text-brand">{copy['survey.title']}</h1>
      <fieldset>
        <legend className="mb-3 text-[19px] font-bold">{surveyPreferred.label}</legend>
        <div className="flex flex-col gap-2">
          <Choice options={surveyPreferred.options} value={preferred ?? undefined} onChange={(x) => setPreferred(x as string)} />
        </div>
      </fieldset>
      {items.map(([label, val, set]) => (
        <div key={label} className="flex flex-col gap-3">
          <p className="text-[19px] font-bold">{label}</p>
          <EmojiScale value={val} onChange={set} ends={copy['survey.ends']} label={label} />
        </div>
      ))}
      <label className="flex flex-col gap-2">
        <span className="text-[19px] font-bold">{copy['survey.comment']}</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, 1000))}
          rows={4}
          className="w-full rounded-xl border-2 border-line bg-card p-4 text-[18px] outline-none focus:border-brand"
        />
      </label>
      <div>
        <Button
          disabled={!complete || busy}
          onClick={async () => {
            setBusy(true);
            await onSubmit({ preferredHelp: preferred, fair, understood, wantAgain, comment: comment.trim() || undefined });
            setBusy(false);
          }}
        >
          {copy['survey.finish']}
        </Button>
      </div>
    </main>
  );
}

function DoneScreen({ username, onDone }: { username: string; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    store('local', DONE_KEY, '1');
  }, []);
  return (
    <main className="mt-12 flex flex-col items-center gap-6 text-center">
      <h1 className="text-[28px] leading-tight font-extrabold text-brand">{fill(copy['done.title'], { username })}</h1>
      <p className="max-w-full border-[3px] border-brand-bright px-4 py-4 text-[24px] font-extrabold whitespace-nowrap text-brand max-[359px]:px-3 max-[359px]:text-[21px] min-[400px]:text-[28px] sm:px-6 sm:text-[37px]">
        {username}
      </p>
      <p className="text-[20px]">{copy['done.save']}</p>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onDone();
        }}
      >
        {copy['done.button']}
      </Button>
    </main>
  );
}
