import { evaluateReadiness } from "@/lib/readiness/engine";
import type { EngineInput, Readiness } from "@/lib/readiness/types";
import type { Queryable } from "@/lib/db/types";
import { conflict, notFound } from "@/lib/errors";
import type { Actor, Ctx } from "./context";
import { SYSTEM_ACTOR } from "./context";

export interface EventActor {
  id: string | null;
  label: string;
}

export const asEventActor = (a: Actor): EventActor => ({ id: a.id, label: a.name });

export interface NewEvent {
  type: string;
  actor: EventActor;
  requirementId?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
}

/** Appends to the activity log. Returns false when the idempotency key was already recorded. */
export async function appendEvent(q: Queryable, launchId: string, at: Date, e: NewEvent): Promise<boolean> {
  const rows = await q.query(
    `insert into events (launch_id, type, actor_id, actor_label, requirement_id, payload, idempotency_key, created_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     on conflict (launch_id, idempotency_key) do nothing
     returning id`,
    [
      launchId,
      e.type,
      e.actor.id,
      e.actor.label,
      e.requirementId ?? null,
      e.payload ?? {},
      e.idempotencyKey ?? null,
      at,
    ],
  );
  return rows.length > 0;
}

interface ReqRow {
  id: string;
  title: string;
  kind: EngineInput["requirements"][number]["kind"];
  mandatory: boolean;
  deadline_at: Date | null;
  depends_on: string[] | null;
  funding_amount: string | null;
  funding_token_decimals: number | null;
  funding_token_symbol: string | null;
}

export async function loadEngineInput(q: Queryable, launchId: string, now: Date): Promise<EngineInput> {
  const [reqs, asgs, evs, txs] = await Promise.all([
    q.query<ReqRow & Record<string, unknown>>(
      `select id, title, kind::text as kind, mandatory, deadline_at, depends_on::text[] as depends_on,
              funding_amount::text as funding_amount, funding_token_decimals, funding_token_symbol
       from requirements where launch_id = $1 order by position, created_at, id`,
      [launchId],
    ),
    q.query(
      `select id, requirement_id, role, state::text as state, label, confirmed_at, decline_reason
       from assignments where launch_id = $1`,
      [launchId],
    ),
    q.query(
      `select id, requirement_id, assignment_id, kind, verification, submitted_at, verified_at,
              verification_detail->>'summary' as detail
       from evidence where launch_id = $1`,
      [launchId],
    ),
    q.query(
      `select id, requirement_id, status, amount::text as amount, block_timestamp
       from funding_transactions where launch_id = $1`,
      [launchId],
    ),
  ]);

  return {
    now,
    requirements: reqs.map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      mandatory: r.mandatory,
      deadlineAt: r.deadline_at,
      dependsOn: r.depends_on ?? [],
      fundingAmount: r.funding_amount,
      fundingDecimals: r.funding_token_decimals,
      fundingSymbol: r.funding_token_symbol,
    })),
    assignments: asgs.map((a) => ({
      id: a.id as string,
      requirementId: a.requirement_id as string,
      role: a.role as "primary" | "backup",
      state: a.state as EngineInput["assignments"][number]["state"],
      label: a.label as string,
      confirmedAt: (a.confirmed_at as Date | null) ?? null,
      declineReason: (a.decline_reason as string | null) ?? null,
    })),
    evidence: evs.map((e) => ({
      id: e.id as string,
      requirementId: e.requirement_id as string,
      assignmentId: (e.assignment_id as string | null) ?? null,
      kind: e.kind as "url" | "note",
      verification: e.verification as "unverified" | "verified" | "failed",
      submittedAt: e.submitted_at as Date,
      verifiedAt: (e.verified_at as Date | null) ?? null,
      detail: (e.detail as string | null) ?? null,
    })),
    fundingTxs: txs.map((t) => ({
      id: t.id as string,
      requirementId: t.requirement_id as string,
      status: t.status as "pending" | "verified" | "rejected",
      amount: (t.amount as string | null) ?? null,
      blockTimestamp: (t.block_timestamp as Date | null) ?? null,
    })),
  };
}

export async function evaluateLaunch(q: Queryable, launchId: string, now: Date): Promise<Readiness> {
  return evaluateReadiness(await loadEngineInput(q, launchId, now));
}

/**
 * Re-evaluates readiness from recorded state and persists the verdict. If the verdict (overall
 * state or any requirement status) changed, a `readiness.changed` event is written. The stored
 * verdict is derived data: nothing else writes it.
 */
export async function recompute(q: Queryable, launchId: string, now: Date, cause: string): Promise<Readiness> {
  const readiness = await evaluateLaunch(q, launchId, now);
  const prev = await q.query<{ readiness_state: string; fingerprint: string | null }>(
    `select readiness_state, readiness_result->>'fingerprint' as fingerprint from launches where id = $1`,
    [launchId],
  );
  if (prev.length === 0) throw notFound("Launch not found");

  await q.query(
    `update launches set readiness_state = $2, readiness_result = $3::jsonb, readiness_computed_at = $4,
            rev = rev + 1, updated_at = $4 where id = $1`,
    [launchId, readiness.state, readiness, now],
  );

  const before = prev[0];
  if (before.fingerprint !== readiness.fingerprint || before.readiness_state !== readiness.state) {
    await appendEvent(q, launchId, now, {
      type: "readiness.changed",
      actor: SYSTEM_ACTOR,
      payload: {
        cause,
        from: before.readiness_state,
        to: readiness.state,
        headline: readiness.headline,
        blockers: readiness.blockers.map((b) => ({ id: b.requirementId, title: b.title, severity: b.severity })),
      },
    });
  }
  return readiness;
}

export interface LockedLaunch {
  id: string;
  workspaceId: string;
  name: string;
  targetAt: Date;
  decision: string | null;
}

/**
 * Runs `fn` as a single serialised unit of work for one launch:
 *  1. takes a row lock on the launch, so concurrent mutations queue instead of interleaving;
 *  2. short-circuits if `idempotencyKey` was already recorded (duplicate delivery / double click);
 *  3. recomputes readiness before commit, so a stored verdict is never stale relative to its data.
 */
export async function withLaunch<T>(
  ctx: Ctx,
  launchId: string,
  opts: { idempotencyKey?: string | null; cause: string },
  fn: (tx: Queryable, launch: LockedLaunch, now: Date) => Promise<T>,
): Promise<{ duplicate: false; value: T } | { duplicate: true }> {
  return ctx.db.transaction(async (tx) => {
    const rows = await tx.query(
      `select id, workspace_id, name, target_at, decision from launches where id = $1 for update`,
      [launchId],
    );
    if (rows.length === 0) throw notFound("Launch not found");
    const l = rows[0];
    const launch: LockedLaunch = {
      id: l.id as string,
      workspaceId: l.workspace_id as string,
      name: l.name as string,
      targetAt: l.target_at as Date,
      decision: (l.decision as string | null) ?? null,
    };

    if (opts.idempotencyKey) {
      const seen = await tx.query(`select 1 from events where launch_id = $1 and idempotency_key = $2`, [
        launchId,
        opts.idempotencyKey,
      ]);
      if (seen.length > 0) return { duplicate: true as const };
    }

    const now = ctx.now();
    const value = await fn(tx, launch, now);
    await recompute(tx, launchId, now, opts.cause);
    return { duplicate: false as const, value };
  });
}


/** Once the founder has recorded a proceed decision the launch record is frozen until they revert to hold. */
export function assertNotLaunched(l: LockedLaunch) {
  if (l.decision === "proceed" || l.decision === "proceed_override") {
    throw conflict("The founder has recorded a launch decision. Set it back to hold to make changes.");
  }
}
