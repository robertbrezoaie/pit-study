// Dev/test only: DB_DRIVER=pglite swaps Supabase for an in-memory Postgres (see lib/devdb).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.DB_DRIVER !== 'pglite') return;
  if (process.env.VERCEL) throw new Error('DB_DRIVER=pglite must never be used on Vercel');
  const { createPgliteDb } = await import('./lib/devdb/pgliteClient');
  (globalThis as { __pitDevDb?: unknown }).__pitDevDb = createPgliteDb();
}
