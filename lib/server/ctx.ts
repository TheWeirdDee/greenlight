import "server-only";
import { createChainVerifier } from "@/lib/chain/verifier";
import { createPostgresDb } from "@/lib/db/postgres";
import { serverEnv } from "@/lib/env";
import type { Ctx } from "@/lib/services/context";
import { createUrlChecker } from "@/lib/verify/url-check";

let cached: Ctx | undefined;

/** Process-wide service context: pooled DB connection, real clock, real chain and URL verifiers. */
export function getCtx(): Ctx {
  if (!cached) {
    const env = serverEnv();
    cached = {
      db: createPostgresDb(env.DATABASE_URL),
      now: () => new Date(),
      chain: createChainVerifier(),
      urlChecker: createUrlChecker(),
    };
  }
  return cached;
}
