// DEV/TEST ONLY. A tiny Supabase-shaped query builder over an in-memory PGlite database that runs
// the real migration. Loaded by instrumentation.ts only when DB_DRIVER=pglite (never in production),
// so the whole learner flow can be exercised end-to-end without a Supabase project.
// Supports only the calls this app makes: select/insert/update with eq/is/in/ilike, single/maybeSingle, rpc.

import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

function toParam(v: unknown): unknown {
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

function fromRow(r: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}

class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' = 'select';
  private cols = '*';
  private returning: string | null = null;
  private values: Row | null = null;
  private where: { sql: (i: number) => string; params: unknown[] }[] = [];
  private mode: 'many' | 'single' | 'maybe' = 'many';
  private countOnly = false;

  constructor(
    private pg: Promise<PGlite>,
    private table: string,
  ) {}

  select(cols = '*', opts?: { count?: 'exact'; head?: boolean }) {
    if (this.op === 'select') this.cols = cols;
    else this.returning = cols;
    if (opts?.count && opts.head) this.countOnly = true;
    return this;
  }
  insert(row: Row) {
    this.op = 'insert';
    this.values = row;
    return this;
  }
  update(patch: Row) {
    this.op = 'update';
    this.values = patch;
    return this;
  }
  eq(col: string, v: unknown) {
    this.where.push({ sql: (i) => `${ident(col)} = $${i}`, params: [v] });
    return this;
  }
  neq(col: string, v: unknown) {
    this.where.push({ sql: (i) => `${ident(col)} <> $${i}`, params: [v] });
    return this;
  }
  gte(col: string, v: unknown) {
    this.where.push({ sql: (i) => `${ident(col)} >= $${i}`, params: [v] });
    return this;
  }
  is(col: string, v: null) {
    this.where.push({ sql: () => `${ident(col)} is ${v === null ? 'null' : 'not null'}`, params: [] });
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.where.push({ sql: (i) => `${ident(col)} = any($${i})`, params: [vs] });
    return this;
  }
  ilike(col: string, v: string) {
    this.where.push({ sql: (i) => `${ident(col)} ilike $${i}`, params: [v] });
    return this;
  }
  single() {
    this.mode = 'single';
    return this;
  }
  maybeSingle() {
    this.mode = 'maybe';
    return this;
  }

  private build(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const cols = (c: string) => (c === '*' ? '*' : c.split(',').map((x) => ident(x.trim())).join(', '));
    const whereSql = () => {
      if (!this.where.length) return '';
      const parts = this.where.map((w) => {
        const s = w.sql(params.length + 1);
        params.push(...w.params);
        return s;
      });
      return ` where ${parts.join(' and ')}`;
    };
    if (this.op === 'select') {
      const sql = this.countOnly
        ? `select count(*)::int as count from ${ident(this.table)}`
        : `select ${cols(this.cols)} from ${ident(this.table)}`;
      return { sql: sql + whereSql(), params };
    }
    const entries = Object.entries(this.values ?? {}).filter(([, v]) => v !== undefined);
    const ret = this.returning ? ` returning ${cols(this.returning)}` : '';
    if (this.op === 'insert') {
      const names = entries.map(([k]) => ident(k)).join(', ');
      const ph = entries.map((_, i) => `$${i + 1}`).join(', ');
      params.push(...entries.map(([, v]) => toParam(v)));
      return { sql: `insert into ${ident(this.table)} (${names}) values (${ph})${ret}`, params };
    }
    const sets = entries.map(([k], i) => `${ident(k)} = $${i + 1}`).join(', ');
    params.push(...entries.map(([, v]) => toParam(v)));
    return { sql: `update ${ident(this.table)} set ${sets}${whereSql()}${ret}`, params };
  }

  async run(): Promise<Result> {
    const pg = await this.pg;
    const { sql, params } = this.build();
    try {
      const res = await pg.query<Row>(sql, params);
      const rows = res.rows.map(fromRow);
      if (this.countOnly) return { data: null, error: null, count: rows[0]?.count as number };
      if (this.op !== 'select' && !this.returning) return { data: null, error: null };
      if (this.mode === 'many') return { data: rows, error: null };
      if (rows.length === 0) {
        return this.mode === 'maybe'
          ? { data: null, error: null }
          : { data: null, error: { message: 'no rows', code: 'PGRST116' } };
      }
      if (rows.length > 1) return { data: null, error: { message: 'multiple rows', code: 'PGRST116' } };
      return { data: rows[0], error: null };
    } catch (e) {
      const err = e as { message: string; code?: string };
      return { data: null, error: { message: err.message, code: err.code } };
    }
  }

  then<A, B>(ok?: ((v: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.run().then(ok, fail);
  }
}

export interface PgliteDb {
  pg: Promise<PGlite>;
  from(table: string): Query;
  rpc(fn: string, args: Row): Promise<Result>;
}

export function createPgliteDb(questionsFile = 'seed/questions.json'): PgliteDb {
  const pg = (async () => {
    const db = await PGlite.create({ extensions: { pgcrypto } });
    for (const f of readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'));
    }
    const bank = JSON.parse(readFileSync(questionsFile, 'utf8')) as Row[];
    for (const q of bank) {
      await db.query(
        `insert into questions (id, domain, tier, bands, prompt_ro, reference_answer_ro, rubric, misconceptions, explanation_ro)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [q.id, q.domain, q.tier, q.bands, q.prompt_ro, q.reference_answer_ro, JSON.stringify(q.rubric), JSON.stringify(q.misconceptions), q.explanation_ro],
      );
    }
    console.log(`[pglite] in-memory database ready with ${bank.length} questions`);
    return db;
  })();

  return {
    pg,
    from: (table) => new Query(pg, table),
    async rpc(fn, args) {
      const db = await pg;
      const entries = Object.entries(args);
      const sql = `select ${ident(fn)}(${entries.map(([k], i) => `${k} := $${i + 1}`).join(', ')}) as result`;
      try {
        const r = await db.query<{ result: unknown }>(sql, entries.map(([, v]) => v));
        return { data: r.rows[0]?.result ?? null, error: null };
      } catch (e) {
        const err = e as { message: string; code?: string };
        return { data: null, error: { message: err.message, code: err.code } };
      }
    },
  };
}
