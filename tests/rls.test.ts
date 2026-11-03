import { describe, expect, it } from "vitest";
import { acceptInvitation, inviteContributor, releaseContributor } from "@/lib/services/assignments";
import { addRequirement, createLaunch, createWorkspace } from "@/lib/services/launches";
import { setup } from "./helpers/harness";

/**
 * Row Level Security is the second wall behind the server-side authorization: even a user who
 * talks to Postgres directly (as the browser Supabase client does for Realtime) can only read what
 * they're entitled to, and can write nothing.
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
  await s.pg.exec(`grant usage on schema public to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated;`);
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
  return { s, founder, ada, mallory, launch, req: req.value.id, inv: inv.value, as, rows };
}

describe("row level security", () => {
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

  it("exposes no sensitive tables directly: assignments (invite hashes), evidence, funding, requirements, members", async () => {
    const w = await world();
    for (const t of ["assignments", "evidence", "funding_transactions", "requirements", "workspaces", "workspace_members"]) {
      expect((await w.as(w.founder.id, () => w.rows(t))).length, `${t} visible to founder via direct SQL`).toBe(0);
      expect((await w.as(w.ada.id, () => w.rows(t))).length, `${t} visible to contributor via direct SQL`).toBe(0);
    }
  });

  it("only ever shows a user their own profile", async () => {
    const w = await world();
    const mine = await w.as(w.mallory.id, () => w.rows("profiles"));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: w.mallory.id });
  });

  it("has no write path from the browser role at all", async () => {
    const w = await world();
    const workspaceId = (await w.s.pg.query<{ workspace_id: string }>(`select workspace_id from launches`)).rows[0].workspace_id;
    for (const who of [w.founder, w.ada, w.mallory]) {
      await w.as(who.id, async () => {
        await expect(
          w.s.pg.query(`insert into launches (workspace_id, name, target_at, created_by) values ($1, 'x', now(), $2)`, [workspaceId, who.id]),
        ).rejects.toThrow();
        // UPDATE/DELETE affect zero rows because no policy exposes a writable row.
        const upd = await w.s.pg.query(`update launches set name = 'hijacked' where id = $1`, [w.launch.id]);
        const del = await w.s.pg.query(`delete from events where launch_id = $1`, [w.launch.id]);
        expect(upd.affectedRows).toBe(0);
        expect(del.affectedRows).toBe(0);
        await expect(
          w.s.pg.query(`update launches set readiness_state = 'ready' where id = $1`, [w.launch.id]),
        ).resolves.toMatchObject({ affectedRows: 0 });
      });
    }
    const name = (await w.s.pg.query<{ name: string; readiness_state: string }>(`select name, readiness_state from launches`)).rows[0];
    expect(name).toEqual({ name: "Acme launch", readiness_state: "not_ready" });
  });
});
