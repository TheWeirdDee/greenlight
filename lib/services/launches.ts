import type { z } from "zod";
import type { Db, Queryable } from "@/lib/db/types";
import { invalid, notFound } from "@/lib/errors";
import { launchInput, requirementInput, workspaceInput } from "@/lib/validation";
import { requireLaunchOwner, ensureWorkspaceOwner } from "./access";
import type { Actor, Ctx } from "./context";
import { appendEvent, asEventActor, assertNotLaunched, recompute, withLaunch } from "./core";

export async function ensureProfile(db: Db, p: { id: string; email: string | null; name: string }) {
  await db.query(
    `insert into profiles (id, display_name, email) values ($1, $2, $3)
     on conflict (id) do update set email = excluded.email`,
    [p.id, p.name.slice(0, 80) || "Member", p.email],
  );
}

export async function createWorkspace(ctx: Ctx, actor: Actor, raw: z.input<typeof workspaceInput>) {
  const input = workspaceInput.parse(raw);
  return ctx.db.transaction(async (tx) => {
    const [ws] = await tx.query<{ id: string }>(
      `insert into workspaces (name, owner_id) values ($1, $2) returning id`,
      [input.name, actor.id],
    );
    await tx.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [
      ws.id,
      actor.id,
    ]);
    return { id: ws.id };
  });
}

export async function createLaunch(ctx: Ctx, actor: Actor, workspaceId: string, raw: z.input<typeof launchInput>) {
  const input = launchInput.parse(raw);
  const now = ctx.now();
  if (input.targetAt.getTime() <= now.getTime()) throw invalid("Target date must be in the future");

  return ctx.db.transaction(async (tx) => {
    await ensureWorkspaceOwner(tx, actor.id, workspaceId);
    const [launch] = await tx.query<{ id: string }>(
      `insert into launches (workspace_id, name, tagline, target_at, created_by)
       values ($1, $2, $3, $4, $5) returning id`,
      [workspaceId, input.name, input.tagline, input.targetAt, actor.id],
    );
    await appendEvent(tx, launch.id, now, {
      type: "launch.created",
      actor: asEventActor(actor),
      payload: { name: input.name, targetAt: input.targetAt.toISOString() },
    });
    await recompute(tx, launch.id, now, "launch.created");
    return { id: launch.id };
  });
}

export async function updateLaunch(
  ctx: Ctx,
  actor: Actor,
  launchId: string,
  raw: z.input<typeof launchInput>,
  idempotencyKey?: string,
) {
  const input = launchInput.parse(raw);
  return withLaunch(ctx, launchId, { idempotencyKey, cause: "launch.updated" }, async (tx, launch, now) => {
    await requireLaunchOwner(tx, actor.id, launchId);
    assertNotLaunched(launch);
    await tx.query(`update launches set name = $2, tagline = $3, target_at = $4 where id = $1`, [
      launchId,
      input.name,
      input.tagline,
      input.targetAt,
    ]);
    await appendEvent(tx, launchId, now, {
      type: "launch.updated",
      actor: asEventActor(actor),
      payload: { name: input.name, targetAt: input.targetAt.toISOString() },
      idempotencyKey,
    });
  });
}

/** Rejects dependency graphs containing a cycle (including self-dependency). */
export function assertAcyclic(edges: Map<string, string[]>) {
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) throw invalid("Dependencies cannot form a cycle");
    state.set(id, 1);
    for (const d of edges.get(id) ?? []) visit(d);
    state.set(id, 2);
  };
  for (const id of edges.keys()) visit(id);
}

async function loadEdges(q: Queryable, launchId: string) {
  const rows = await q.query<{ id: string; depends_on: string[] | null }>(
    `select id, depends_on::text[] as depends_on from requirements where launch_id = $1`,
    [launchId],
  );
  return new Map(rows.map((r) => [r.id, r.depends_on ?? []]));
}

const uuidArray = (ids: string[]) => `{${ids.join(",")}}`;

export async function addRequirement(
  ctx: Ctx,
  actor: Actor,
  launchId: string,
  raw: z.input<typeof requirementInput>,
  idempotencyKey?: string,
) {
  const input = requirementInput.parse(raw);
  await requireLaunchOwner(ctx.db, actor.id, launchId);

  // Read the token's decimals/symbol from the chain itself rather than trusting the form.
  const token = input.funding ? await ctx.chain.tokenInfo(input.funding.chainId, input.funding.token) : null;

  return withLaunch(ctx, launchId, { idempotencyKey, cause: "requirement.added" }, async (tx, launch, now) => {
    await requireLaunchOwner(tx, actor.id, launchId);
    assertNotLaunched(launch);

    const edges = await loadEdges(tx, launchId);
    for (const dep of input.dependsOn) if (!edges.has(dep)) throw invalid("A dependency does not belong to this launch");

    const funding = input.funding;
    const amount = funding && token ? toBaseUnits(funding.amount, token.decimals) : null;
    const [row] = await tx.query<{ id: string }>(
      `insert into requirements
         (launch_id, position, title, description, kind, mandatory, deadline_at, depends_on,
          funding_chain_id, funding_token, funding_token_symbol, funding_token_decimals,
          funding_recipient, funding_amount, funding_min_confirmations)
       values ($1, (select coalesce(max(position), -1) + 1 from requirements where launch_id = $1),
               $2, $3, $4, $5, $6, $7::uuid[], $8, $9, $10, $11, $12, $13, $14)
       returning id`,
      [
        launchId,
        input.title,
        input.description,
        input.kind,
        input.mandatory,
        input.deadlineAt,
        uuidArray(input.dependsOn),
        funding?.chainId ?? null,
        funding ? funding.token.toLowerCase() : null,
        token?.symbol ?? null,
        token?.decimals ?? null,
        funding ? funding.recipient.toLowerCase() : null,
        amount,
        funding?.minConfirmations ?? null,
      ],
    );
    await appendEvent(tx, launchId, now, {
      type: "requirement.added",
      actor: asEventActor(actor),
      requirementId: row.id,
      payload: { title: input.title, kind: input.kind, mandatory: input.mandatory },
      idempotencyKey,
    });
    return { id: row.id };
  });
}

export async function updateRequirement(
  ctx: Ctx,
  actor: Actor,
  requirementId: string,
  patch: {
    title?: string;
    description?: string;
    mandatory?: boolean;
    deadlineAt?: Date | null;
    dependsOn?: string[];
  },
  idempotencyKey?: string,
) {
  const [owner] = await ctx.db.query<{ launch_id: string }>(`select launch_id from requirements where id = $1`, [
    requirementId,
  ]);
  if (!owner) throw notFound("Requirement not found");
  const launchId = owner.launch_id;

  return withLaunch(ctx, launchId, { idempotencyKey, cause: "requirement.updated" }, async (tx, launch, now) => {
    await requireLaunchOwner(tx, actor.id, launchId);
    assertNotLaunched(launch);
    const rows = await tx.query(`select 1 from requirements where id = $1 and launch_id = $2`, [requirementId, launchId]);
    if (rows.length === 0) throw notFound("Requirement not found");

    if (patch.dependsOn) {
      const edges = await loadEdges(tx, launchId);
      for (const dep of patch.dependsOn) if (!edges.has(dep)) throw invalid("A dependency does not belong to this launch");
      edges.set(requirementId, patch.dependsOn);
      assertAcyclic(edges);
    }
    if (patch.title !== undefined && (patch.title.trim().length < 1 || patch.title.length > 140)) {
      throw invalid("Title must be 1–140 characters");
    }

    await tx.query(
      `update requirements set
         title = coalesce($2, title),
         description = coalesce($3, description),
         mandatory = coalesce($4, mandatory),
         deadline_at = case when $5::boolean then $6::timestamptz else deadline_at end,
         depends_on = coalesce($7::uuid[], depends_on),
         updated_at = $8
       where id = $1`,
      [
        requirementId,
        patch.title?.trim() ?? null,
        patch.description ?? null,
        patch.mandatory ?? null,
        patch.deadlineAt !== undefined,
        patch.deadlineAt ?? null,
        patch.dependsOn ? uuidArray(patch.dependsOn) : null,
        now,
      ],
    );
    await appendEvent(tx, launchId, now, {
      type: "requirement.updated",
      actor: asEventActor(actor),
      requirementId,
      payload: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.mandatory !== undefined ? { mandatory: patch.mandatory } : {}),
        ...(patch.deadlineAt !== undefined ? { deadlineAt: patch.deadlineAt?.toISOString() ?? null } : {}),
        ...(patch.dependsOn ? { dependsOn: patch.dependsOn } : {}),
      },
      idempotencyKey,
    });
  });
}

export async function removeRequirement(ctx: Ctx, actor: Actor, requirementId: string, idempotencyKey?: string) {
  const [owner] = await ctx.db.query<{ launch_id: string; title: string }>(
    `select launch_id, title from requirements where id = $1`,
    [requirementId],
  );
  if (!owner) throw notFound("Requirement not found");
  return withLaunch(ctx, owner.launch_id, { idempotencyKey, cause: "requirement.removed" }, async (tx, launch, now) => {
    await requireLaunchOwner(tx, actor.id, owner.launch_id);
    assertNotLaunched(launch);
    const funded = await tx.query(
      `select 1 from funding_transactions where requirement_id = $1 and status = 'verified' limit 1`,
      [requirementId],
    );
    if (funded.length > 0) throw conflict("Cannot remove a requirement that already has verified funding");
    await tx.query(`update requirements set depends_on = array_remove(depends_on, $1::uuid) where launch_id = $2`, [
      requirementId,
      owner.launch_id,
    ]);
    await tx.query(`delete from requirements where id = $1`, [requirementId]);
    await appendEvent(tx, owner.launch_id, now, {
      type: "requirement.removed",
      actor: asEventActor(actor),
      payload: { title: owner.title },
      idempotencyKey,
    });
  });
}

/** Converts a decimal string like "12.5" to token base units, rejecting excess precision. */
export function toBaseUnits(amount: string, decimals: number): string {
  const [whole, frac = ""] = amount.split(".");
  if (frac.length > decimals) throw invalid(`Amount has more than ${decimals} decimal places`);
  const units = BigInt(whole + frac.padEnd(decimals, "0"));
  if (units <= 0n) throw invalid("Amount must be greater than zero");
  return units.toString();
}

export function formatUnits(units: string, decimals: number): string {
  const s = units.padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
