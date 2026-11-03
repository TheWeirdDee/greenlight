import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Db, Queryable, Row } from "@/lib/db/types";
import type {
  Actor,
  ChainVerifier,
  Ctx,
  FundingCheckInput,
  FundingVerification,
  UrlChecker,
  UrlCheckResult,
} from "@/lib/services/context";
import { TxNotFoundError } from "@/lib/services/context";
import { ensureProfile } from "@/lib/services/launches";

/** Test seam over PGlite: the real migrations, real SQL, real transactions — no mocks of our own queries. */
export function pgliteDb(pg: PGlite): Db {
  const wrap = (runner: Pick<PGlite, "query">): Queryable => ({
    async query<T extends Row = Row>(text: string, params: unknown[] = []) {
      const res = await runner.query<T>(text, params);
      return res.rows;
    },
  });
  return {
    ...wrap(pg),
    transaction: (fn) => pg.transaction(async (tx) => fn(wrap(tx))),
  };
}

const BOOTSTRAP = `
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;
`;

export async function freshDb() {
  const pg = new PGlite();
  await pg.exec(BOOTSTRAP);
  const dir = join(process.cwd(), "supabase", "migrations");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(join(dir, f), "utf8"));
  }
  return { pg, db: pgliteDb(pg) };
}

/** A controllable clock so deadline behaviour is tested deterministically. */
export class TestClock {
  constructor(private t: Date) {}
  now = () => new Date(this.t);
  set(d: Date) {
    this.t = d;
  }
  advanceHours(h: number) {
    this.t = new Date(this.t.getTime() + h * 3_600_000);
  }
}

export interface FakeTx extends FundingVerification {
  token?: string;
}

export class FakeChain implements ChainVerifier {
  private txs = new Map<string, (input: FundingCheckInput) => FundingVerification>();
  calls = 0;
  /** Register what the "chain" would report for a hash. */
  set(hash: string, v: (input: FundingCheckInput) => FundingVerification) {
    this.txs.set(hash, v);
  }
  drop(hash: string) {
    this.txs.delete(hash);
  }
  async tokenInfo() {
    return { decimals: 6, symbol: "USDC" };
  }
  async verifyTransfer(input: FundingCheckInput): Promise<FundingVerification> {
    this.calls += 1;
    const f = this.txs.get(input.txHash);
    if (!f) throw new TxNotFoundError();
    return f(input);
  }
}

export class FakeUrls implements UrlChecker {
  results = new Map<string, UrlCheckResult>();
  async check(url: string) {
    return (
      this.results.get(url) ?? { ok: false, status: null, summary: "Could not connect to the site", finalUrl: null }
    );
  }
}

let counter = 0;
const uuid = () => {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString().padStart(12, "0")}`;
};

export async function setup(startAt = new Date("2026-11-05T10:00:00Z")) {
  const { pg, db } = await freshDb();
  const clock = new TestClock(startAt);
  const chain = new FakeChain();
  const urls = new FakeUrls();
  const ctx: Ctx = { db, now: clock.now, chain, urlChecker: urls };

  const user = async (name: string): Promise<Actor> => {
    const id = uuid();
    await pg.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${name.toLowerCase()}@example.test`]);
    await ensureProfile(db, { id, email: `${name.toLowerCase()}@example.test`, name });
    return { id, name };
  };
  return { pg, db, ctx, clock, chain, urls, user };
}

export const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
export const RECIPIENT = "0x1111111111111111111111111111111111111111";
export const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

export function goodTransfer(amount: string, opts: Partial<FundingVerification> = {}): FundingVerification {
  return {
    status: "verified",
    reason: null,
    from: "0x2222222222222222222222222222222222222222",
    to: RECIPIENT,
    token: USDC,
    amount,
    blockNumber: "1000",
    blockTimestamp: new Date("2026-11-05T10:30:00Z"),
    confirmations: 5,
    ...opts,
  };
}
