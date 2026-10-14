import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { beforeAll, describe, expect, it } from 'vitest';

// Runs the real migration and the saved queries on an in-process Postgres (PGlite).

let pg: PGlite;
const migration = ['0001_init.sql', '0002_ops_alerts.sql'].map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n');
const queries = readFileSync('supabase/queries.sql', 'utf8');

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec(migration);
});

async function seedSession(isTest: boolean): Promise<{ sid: string; qid: string }> {
  const p = await pg.query<{ id: string }>(
    `insert into participants (username) values ($1) returning id`,
    [`Test${Math.random().toString(36).slice(2, 8)}Name${Math.floor(10 + Math.random() * 89)}`],
  );
  await pg.query(
    `insert into questions (id, domain, tier, prompt_ro, reference_answer_ro, rubric, explanation_ro)
     values ('ALG-E1','algorithms','easy','q','ref','{"0":"a","1":"b","2":"c","3":"d"}','expl')
     on conflict (id) do nothing`,
  );
  const s = await pg.query<{ id: string }>(
    `insert into sessions (participant_id, is_test, assent, grade, grade_band, age_band, gender, self_reported_prior,
       setting, question_ids, selection_seed, app_version, prompt_version, grader_model, tutor_model, random_share)
     values ($1, $2, true, 6, 'lower', '12-13', 'girl', 'no', 'class', '{ALG-E1}', 'seed', 'test', 'v1', 'm', 'm', 0.5)
     returning id`,
    [p.rows[0].id, isTest],
  );
  return { sid: s.rows[0].id, qid: 'ALG-E1' };
}

async function seedDecision(sid: string, qid: string, arm = 'hint') {
  const a = await pg.query<{ id: string }>(
    `insert into answers (session_id, question_id, question_version, attempt, text, shown_at, response_ms, grader_status, score,
       flags, rating_sample)
     values ($1, $2, 1, 1, 'raspuns', now(), 1000, 'ok', 1, '{"needs_adult_attention": true}', true) returning id`,
    [sid, qid],
  );
  const d = await pg.query<{ id: string }>(
    `insert into decisions (session_id, question_id, first_answer_id, allocator_half, assigned_arm, delivered_arm, propensity,
       propensities, thompson_probs, posterior_snapshot, tutor_status)
     values ($1, $2, $3, 'random', $4, $4, 0.33, '{}', '{}', '{}', 'ok') returning id`,
    [sid, qid, a.rows[0].id, arm],
  );
  const r = await pg.query<{ id: string }>(
    `insert into answers (session_id, question_id, question_version, attempt, text, shown_at, response_ms, grader_status, score)
     values ($1, $2, 1, 2, 'raspuns 2', now(), 900, 'ok', 3) returning id`,
    [sid, qid],
  );
  return { decisionId: d.rows[0].id, retryId: r.rows[0].id };
}

describe('database', () => {
  it('migration creates bandit_state with three Beta(1,1) arms and RLS on every table', async () => {
    const b = await pg.query<{ arm: string; a: number; b: number; n: number }>(`select * from bandit_state order by arm`);
    expect(b.rows.map((r) => [r.arm, r.a, r.b, r.n])).toEqual([
      ['example', 1, 1, 0],
      ['hint', 1, 1, 0],
      ['plain', 1, 1, 0],
    ]);
    const rls = await pg.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace`,
    );
    expect(rls.rows.length).toBe(10);
    expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true);
  });

  it('8.5 #5: 50 parallel update_bandit calls give n = 50 and a + b = 52', async () => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => pg.query(`select update_bandit('example', $1)`, [i % 2])));
    const r = await pg.query<{ a: number; b: number; n: number }>(`select a, b, n from bandit_state where arm = 'example'`);
    expect(r.rows[0].n).toBe(50);
    expect(r.rows[0].a + r.rows[0].b).toBe(52);
  });

  it('finalize_retry records the reward once and updates the bandit only once', async () => {
    const { sid, qid } = await seedSession(false);
    const { decisionId, retryId } = await seedDecision(sid, qid, 'hint');
    const call = () =>
      pg.query<{ ok: boolean }>(`select finalize_retry($1, $2, 1, null, true) as ok`, [decisionId, retryId]);
    const results = await Promise.all([call(), call(), call()]);
    expect(results.filter((r) => r.rows[0].ok).length).toBe(1);
    const st = await pg.query<{ a: number; n: number }>(`select a, n from bandit_state where arm = 'hint'`);
    expect(st.rows[0]).toEqual({ a: 2, n: 1 });
    const d = await pg.query<{ reward: number; bandit_updated: boolean; retry_answer_id: string }>(
      `select reward, bandit_updated, retry_answer_id from decisions where id = $1`,
      [decisionId],
    );
    expect(d.rows[0]).toEqual({ reward: 1, bandit_updated: true, retry_answer_id: retryId });
  });

  it('finalize_retry with p_update = false never touches the bandit', async () => {
    const { sid, qid } = await seedSession(true);
    const { decisionId, retryId } = await seedDecision(sid, qid, 'plain');
    const before = await pg.query<{ n: number }>(`select n from bandit_state where arm = 'plain'`);
    await pg.query(`select finalize_retry($1, $2, null, 'retry_grader_failed', false)`, [decisionId, retryId]);
    const after = await pg.query<{ n: number }>(`select n from bandit_state where arm = 'plain'`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const d = await pg.query<{ excluded_reason: string; reward: number | null }>(
      `select excluded_reason, reward from decisions where id = $1`,
      [decisionId],
    );
    expect(d.rows[0]).toEqual({ excluded_reason: 'retry_grader_failed', reward: null });
  });

  it('one decision per (session, question): a second insert violates the unique constraint', async () => {
    const { sid, qid } = await seedSession(false);
    await seedDecision(sid, qid);
    await expect(seedDecision(sid, qid)).rejects.toThrow();
  });

  it('ops_alerts allows one alert per kind per 10-minute bucket', async () => {
    await pg.query(`insert into ops_alerts (kind, bucket) values ('llm_rate', 1)`);
    await expect(pg.query(`insert into ops_alerts (kind, bucket) values ('llm_rate', 1)`)).rejects.toThrow();
    await pg.query(`insert into ops_alerts (kind, bucket) values ('llm_auth', 1)`);
  });

  it('acceptance 14: every saved query in queries.sql runs on test data', async () => {
    const statements = queries
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements.length).toBe(11);
    for (const sql of statements) {
      await pg.query(sql);
    }
    const q2 = await pg.query(statements[3]); // Q2 (adult attention)
    expect(q2.rows.length).toBeGreaterThan(0);
  });
});
