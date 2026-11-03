import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { createPostgresDb } from "@/lib/db/postgres";
import type { Row } from "@/lib/db/types";
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

/**
 * Integration harness: a real PostgreSQL server (embedded-postgres binaries), the project's real
 * migrations, and the production `postgres.js` adapter. Each scenario gets its own database cloned
 * from a migrated template, so tests are isolated, concurrency is real (separate connections and row
 * locks), and driver-level behaviour (e.g. jsonb parameter encoding) is exercised, not simulated.
 */
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

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

interface Server {
  url: (database: string) => string;
  appUrl: (database: string) => string;
  admin: postgres.Sql;
  stop: () => Promise<void>;
}

let server: Promise<Server> | undefined;

function boot(): Promise<Server> {
  server ??= (async () => {
    const port = await freePort();
    const pg = new EmbeddedPostgres({
      databaseDir: mkdtempSync(join(tmpdir(), "greenlight-test-pg-")),
      user: "postgres",
      password: "postgres",
      port,
      persistent: false,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      onLog: () => {},
      onError: () => {},
    });
    await pg.initialise();
    await pg.start();
    const url = (database: string) => `postgres://postgres:postgres@127.0.0.1:${port}/${database}`;
    const admin = postgres(url("postgres"), { max: 2, onnotice: () => {} });

    await admin.unsafe("create database template_gl");
    const tpl = postgres(url("template_gl"), { max: 1, onnotice: () => {} });
    await tpl.unsafe(BOOTSTRAP);
    // The same two steps scripts/migrate.mjs performs on Supabase: bootstrap (role + schema), then migrations.
    await tpl.unsafe(readFileSync(join(process.cwd(), "supabase", "bootstrap.sql"), "utf8"));
    const dir = join(process.cwd(), "supabase", "migrations");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
      // One transaction per migration, as scripts/migrate.mjs does (the SQL uses SET LOCAL ROLE).
      await tpl.begin(async (tx) => {
        await tx.unsafe(readFileSync(join(dir, f), "utf8"));
      });
    }
    await tpl.end(); // a template database must have no open sessions
    // Role attributes are cluster-wide: let greenlight_app log in, as it does in production.
    await admin.unsafe("alter role greenlight_app login password 'test'");

    return {
      url,
      appUrl: (database: string) => `postgres://greenlight_app:test@127.0.0.1:${port}/${database}`,
      admin,
      stop: async () => {
        await admin.end();
        try {
          await pg.stop();
        } catch (e) {
          // On Windows the server may still hold its data directory while it is being removed (EBUSY/EPERM).
          // The process is stopped either way; leftover temp files must not fail an otherwise green run.
          if (!/EBUSY|EPERM|ENOTEMPTY/.test(String(e))) throw e;
        }
      },
    };
  })();
  return server;
}

/** Stops the server started by this worker (wired to afterAll in tests/helpers/setup.ts). */
export async function stopServer() {
  if (!server) return;
  const s = await server;
  server = undefined;
  await s.stop();
}

/** Raw SQL access for assertions and setup; one connection, so session state (SET ROLE) sticks. */
export interface RawDb {
  query<T extends object = Row>(text: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows: number }>;
  exec(text: string): Promise<void>;
}

const cleanups = new Set<() => Promise<void>>();
let counter = 0;

/** Closes every database opened by the current test (wired to afterEach in tests/helpers/setup.ts). */
export async function closeAll() {
  const all = [...cleanups];
  cleanups.clear();
  await Promise.allSettled(all.map((fn) => fn()));
}

export async function freshDb() {
  const s = await boot();
  counter += 1;
  const name = `t${process.pid}_${counter}_${Date.now().toString(36)}`;
  await s.admin.unsafe(`create database "${name}" template template_gl`);

  process.env.DATABASE_POOL_MAX = "6";
  // The application connects as the dedicated, least-privileged role — never as an administrator.
  const db = createPostgresDb(s.appUrl(name));
  const raw = postgres(s.url(name), { max: 1, prepare: false, onnotice: () => {} });
  await raw.unsafe("set search_path = greenlight"); // assertions read Greenlight tables unqualified
  const pg: RawDb = {
    async query<T extends object = Row>(text: string, params: unknown[] = []) {
      const r = await raw.unsafe(text, params as never);
      return { rows: r as unknown as T[], affectedRows: r.count ?? 0 };
    },
    async exec(text: string) {
      await raw.unsafe(text);
    },
  };

  cleanups.add(async () => {
    await raw.end({ timeout: 1 });
    await db.end?.();
    await s.admin.unsafe(`drop database if exists "${name}" with (force)`);
  });
  return { pg, db };
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

let userCounter = 0;
const uuid = () => {
  userCounter += 1;
  return `00000000-0000-4000-8000-${userCounter.toString().padStart(12, "0")}`;
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
