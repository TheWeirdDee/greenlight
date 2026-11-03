import "server-only";
import { createChainVerifier } from "@/lib/chain/verifier";
import { createPostgresDb } from "@/lib/db/postgres";
import { serverEnv } from "@/lib/env";
import type { Ctx } from "@/lib/services/context";
import { createUrlChecker } from "@/lib/verify/url-check";

// Next.js bundles pages, server actions and route handlers separately, so a module-level cache can
// end up duplicated and open several connection pools. Anchoring it on globalThis guarantees one
// pool per server process.
const globalForCtx = globalThis as unknown as { __greenlightCtx?: Ctx };

/** Process-wide service context: pooled DB connection, real clock, real chain and URL verifiers. */
export function getCtx(): Ctx {
  if (!globalForCtx.__greenlightCtx) {
    const env = serverEnv();
    globalForCtx.__greenlightCtx = {
      db: createPostgresDb(env.DATABASE_URL),
      now: () => new Date(),
      chain: createChainVerifier(),
      urlChecker: createUrlChecker(),
    };
  }
  return globalForCtx.__greenlightCtx;
}
