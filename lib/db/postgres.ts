import postgres from "postgres";
import type { Db, Queryable, Row } from "./types";

type Params = Parameters<postgres.Sql["unsafe"]>[1];

/**
 * postgres.js adapter. `prepare: false` keeps it compatible with Supabase's transaction pooler
 * (port 6543), which does not support prepared statements.
 */
export function createPostgresDb(url: string): Db {
  const max = Number(process.env.DATABASE_POOL_MAX) || 3;
  const sql = postgres(url, { prepare: false, max, idle_timeout: 20, connect_timeout: 10 });

  const wrap = (runner: postgres.Sql | postgres.TransactionSql): Queryable => ({
    async query<T extends object = Row>(text: string, params: unknown[] = []) {
      try {
        const rows = await runner.unsafe(text, params as Params);
        return rows as unknown as T[];
      } catch (e) {
        // Statement text only — parameters can hold secrets (tokens, hashes) and are never logged.
        const code = (e as { code?: string }).code ?? "unknown";
        console.error(`[db] ${code} in: ${text.replace(/\s+/g, " ").trim().slice(0, 140)} (${params.length} params)`);
        throw e;
      }
    },
  });

  return {
    ...wrap(sql),
    end: () => sql.end({ timeout: 2 }),
    transaction: <T>(fn: (tx: Queryable) => Promise<T>) =>
      sql.begin(async (tx) => fn(wrap(tx))) as Promise<T>,
  };
}
