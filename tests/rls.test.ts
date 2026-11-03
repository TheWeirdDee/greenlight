import { describe, expect, it } from "vitest";
import { acceptInvitation, inviteContributor, releaseContributor } from "@/lib/services/assignments";
import { addRequirement, createLaunch, createWorkspace } from "@/lib/services/launches";
import { setup } from "./helpers/harness";

/**
 * Two independent walls protect Greenlight's data from a browser that talks to Postgres directly
 * (as the Supabase client does for Realtime):
 *   1. privileges — the `authenticated` role is granted SELECT on three tables and nothing else, and
 *      the schema is not exposed to PostgREST;
 *   2. Row Level Security — even if privileges were widened by mistake, policies still scope reads and
 *      there are no write policies at all.
 */
async function world() {
  const s = await setup();
  const founder = await s.user("Founder");
  const ada = await s.user("Ada");
  const mallory = await s.user("Mallory");
  const ws = await createWorkspace(s.ctx, founder, { name: "Acme" });
  const launch = await createLaunch(s.ctx, founder, ws.id, { name: "Acme launch", tagline: "", targetAt: "2026-11-09T22:00:00Z" });
  const req = await addRequirement(s.ctx, founder, launch.id, { title: "Announce", kind: "commitment" });
  if (req.duplicate) throw new Error("dup");
  const inv = await inviteContributor(s.ctx, founder, req.value.id, { label: "Ada" });
  if (inv.duplicate) throw new Error("dup");
  const acc = await acceptInvitation(s.ctx, ada, inv.value.token);
  if (acc.duplicate) throw new Error("dup");

  // Behave like PostgREST/Realtime: run as `authenticated` with the caller's id in the JWT claim.
  const as = async <T>(userId: string, fn: () => Promise<T>) => {
    await s.pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
    await s.pg.exec(`set role authenticated`);
    try {
      return await fn();
    } finally {
      await s.pg.exec(`reset role`);
    }
  };
  const rows = (table: string) => s.pg.query(`select * from ${table}`).then((r) => r.rows);
  /** Simulates a future misconfiguration: broad table privileges handed to the browser role. */
  const widenPrivileges = () =>
    s.pg.exec(`grant select, insert, update, delete on all tables in schema greenlight to authenticated`);
  return { s, founder, ada, mallory, launch, req: req.value.id, inv: inv.value, as, rows, widenPrivileges };
}

describe("privileges (first wall)", () => {
  it("lets the founder and an assigned contributor read the launch and its events; nobody else", async () => {
    const w = await world();
    expect((await w.as(w.founder.id, () => w.rows("launches"))).length).toBe(1);
    expect((await w.as(w.ada.id, () => w.rows("launches"))).length).toBe(1);
    expect((await w.as(w.mallory.id, () => w.rows("launches"))).length).toBe(0);

    expect((await w.as(w.founder.id, () => w.rows("events"))).length).toBeGreaterThan(3);
    expect((await w.as(w.ada.id, () => w.rows("events"))).length).toBeGreaterThan(3);
    expect((await w.as(w.mallory.id, () => w.rows("events"))).length).toBe(0);
  });

  it("revokes a contributor's read access as soon as they are released", async () => {
    const w = await world();
    expect((await w.as(w.ada.id, () => w.rows("launches"))).length).toBe(1);
    const r = await releaseContributor(w.s.ctx, w.founder, w.inv.assignmentId);
    if (r.duplicate) throw new Error("dup");
    expect((await w.as(w.ada.id, () => w.rows("launches"))).length).toBe(0);
    expect((await w.as(w.ada.id, () => w.rows("events"))).length).toBe(0);
  });

  it("denies direct access outright to sensitive tables: assignments (invite hashes), evidence, funding, requirements, members", async () => {
    const w = await world();
    for (const t of ["assignments", "evidence", "funding_transactions", "requirements", "workspaces", "workspace_members"]) {
      for (const who of [w.founder, w.ada, w.mallory]) {
        await w.as(who.id, async () => {
          await expect(w.rows(t), `${t} readable by ${who.name} via direct SQL`).rejects.toThrow(/permission denied/);
        });
      }
    }
  });

  it("has no write path from the browser role at all", async () => {
    const w = await world();
    const workspaceId = (await w.s.pg.query<{ workspace_id: string }>(`select workspace_id from launches`)).rows[0].workspace_id;
    for (const who of [w.founder, w.ada, w.mallory]) {
      await w.as(who.id, async () => {
        await expect(
          w.s.pg.query(`insert into launches (workspace_id, name, target_at, created_by) values ($1, 'x', now(), $2)`, [workspaceId, who.id]),
        ).rejects.toThrow(/permission denied/);
        await expect(w.s.pg.query(`update launches set name = 'hijacked' where id = $1`, [w.launch.id])).rejects.toThrow(/permission denied/);
        await expect(w.s.pg.query(`update launches set readiness_state = 'ready' where id = $1`, [w.launch.id])).rejects.toThrow(/permission denied/);
        await expect(w.s.pg.query(`delete from events where launch_id = $1`, [w.launch.id])).rejects.toThrow(/permission denied/);
      });
    }
    const row = (await w.s.pg.query<{ name: string; readiness_state: string }>(`select name, readiness_state from launches`)).rows[0];
    expect(row).toEqual({ name: "Acme launch", readiness_state: "not_ready" });
  });

  it("is not reachable at all by anonymous callers", async () => {
    const w = await world();
    await w.s.pg.exec(`set role anon`);
    try {
      await expect(w.rows("greenlight.launches")).rejects.toThrow(/permission denied for schema greenlight/);
    } finally {
      await w.s.pg.exec(`reset role`);
    }
  });
});

describe("row level security (second wall — holds even if privileges are widened by mistake)", () => {
  it("still scopes reads and exposes nothing sensitive when SELECT is granted on every table", async () => {
    const w = await world();
    await w.widenPrivileges();
    for (const t of ["assignments", "evidence", "funding_transactions", "requirements", "workspaces", "workspace_members"]) {
      expect((await w.as(w.founder.id, () => w.rows(t))).length, `${t} visible to founder`).toBe(0);
      expect((await w.as(w.ada.id, () => w.rows(t))).length, `${t} visible to contributor`).toBe(0);
    }
    expect((await w.as(w.mallory.id, () => w.rows("launches"))).length).toBe(0);
    expect((await w.as(w.ada.id, () => w.rows("launches"))).length).toBe(1);
  });

  it("still has no write path when INSERT/UPDATE/DELETE are granted: no write policy exists", async () => {
    const w = await world();
    await w.widenPrivileges();
    const workspaceId = (await w.s.pg.query<{ workspace_id: string }>(`select workspace_id from launches`)).rows[0].workspace_id;
    for (const who of [w.founder, w.ada, w.mallory]) {
      await w.as(who.id, async () => {
        await expect(
          w.s.pg.query(`insert into launches (workspace_id, name, target_at, created_by) values ($1, 'x', now(), $2)`, [workspaceId, who.id]),
        ).rejects.toThrow(/row-level security/);
        expect((await w.s.pg.query(`update launches set name = 'hijacked' where id = $1`, [w.launch.id])).affectedRows).toBe(0);
        expect((await w.s.pg.query(`delete from events where launch_id = $1`, [w.launch.id])).affectedRows).toBe(0);
      });
    }
  });

  it("only ever shows a user their own profile", async () => {
    const w = await world();
    const mine = await w.as(w.mallory.id, () => w.rows("profiles"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: w.mallory.id });
  });
});

describe("isolation from other applications", () => {
  it("creates nothing outside the greenlight schema", async () => {
    const w = await world();
    const outside = await w.s.pg.query<{ kind: string; name: string }>(
      `select 'table' as kind, schemaname || '.' || tablename as name from pg_tables
         where tableowner = 'greenlight_app' and schemaname <> 'greenlight'
       union all select 'type', n.nspname || '.' || t.typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
         where t.typowner = (select oid from pg_roles where rolname = 'greenlight_app') and n.nspname <> 'greenlight' and t.typtype = 'e'
       union all select 'function', n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where p.proowner = (select oid from pg_roles where rolname = 'greenlight_app') and n.nspname <> 'greenlight'`,
    );
    expect(outside.rows).toEqual([]);
    const inGreenlight = await w.s.pg.query<{ n: number }>(`select count(*)::int as n from pg_tables where schemaname = 'greenlight'`);
    expect(inGreenlight.rows[0].n).toBe(9);
  });

  it("the application role can neither read nor write another application's tables or the shared auth data", async () => {
    const w = await world();
    // A stand-in for another app's table living in `public`, created by someone else.
    await w.s.pg.exec(`create table public.other_app_secrets (id int primary key, secret text); insert into public.other_app_secrets values (1, 'x');`);
    const app = w.s.db;
    await expect(app.query(`select * from public.other_app_secrets`)).rejects.toThrow(/permission denied/);
    await expect(app.query(`insert into public.other_app_secrets values (2, 'y')`)).rejects.toThrow(/permission denied/);
    await expect(app.query(`select * from auth.users`)).rejects.toThrow(/permission denied/);
    await expect(app.query(`create table public.sneaky (id int)`)).rejects.toThrow(/permission denied/);
    // …and an unqualified name resolves to Greenlight's own schema, never to another app's table.
    await w.s.pg.exec(`create table public.launches (id int); insert into public.launches values (42);`);
    const rows = await app.query<{ name: string }>(`select name from launches`);
    expect(rows[0]).toMatchObject({ name: "Acme launch" });
  });

  it("the migration is idempotent under the bootstrap (re-running it changes nothing)", async () => {
    const w = await world();
    const before = (await w.s.pg.query(`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'greenlight'`)).rows[0];
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    await w.s.pg.exec(readFileSync(join(process.cwd(), "supabase", "bootstrap.sql"), "utf8"));
    const after = (await w.s.pg.query(`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'greenlight'`)).rows[0];
    expect(after).toEqual(before);
  });
});
