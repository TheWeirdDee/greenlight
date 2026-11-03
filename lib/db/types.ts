/**
 * Minimal database seam. Production uses postgres.js against Supabase Postgres; tests run the
 * real migrations on an embedded PostgreSQL server through the same adapter.
 */
export type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends object = Row>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Closes the pool (tests and scripts; servers keep it for the process lifetime). */
  end?: () => Promise<void>;
  /** Runs `fn` in a single transaction; rolls back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}
