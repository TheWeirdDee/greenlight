/**
 * Minimal database seam. Production uses postgres.js against Supabase Postgres; tests run the
 * real migrations on an embedded Postgres (PGlite) through the same interface.
 */
export type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Runs `fn` in a single transaction; rolls back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}
