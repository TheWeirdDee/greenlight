import postgres from "postgres";
import type { Db, Queryable, Row } from "./types";

type Params = Parameters<postgres.Sql["unsafe"]>[1];

/**
 * postgres.js adapter. `prepare: false` keeps it compatible with Supabase's transaction pooler
 * (port 6543), which does not support prepared statements.
 */
export function createPostgresDb(url: string): Db {
  const sql = postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 });

  const wrap = (runner: postgres.Sql | postgres.TransactionSql): Queryable => ({
    async query<T extends Row = Row>(text: string, params: unknown[] = []) {
      const rows = await runner.unsafe(text, params as Params);
      return rows as unknown as T[];
    },
  });

  return {
    ...wrap(sql),
    transaction: <T>(fn: (tx: Queryable) => Promise<T>) =>
      sql.begin(async (tx) => fn(wrap(tx))) as Promise<T>,
  };
}
