import type { Readiness } from "@/lib/readiness/types";
import { requireLaunchParticipant } from "./access";
import type { Ctx } from "./context";
import { SYSTEM_ACTOR } from "./context";
import { appendEvent, evaluateLaunch, withLaunch } from "./core";
import { reverifyFunding } from "./funding";

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d === null || d === undefined ? null : String(d));

export interface RoomAssignment {
  id: string;
  requirementId: string;
  role: "primary" | "backup";
  state: string;
  label: string;
  isMine: boolean;
  invitedAt: string | null;
  acceptedAt: string | null;
  confirmedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  releasedAt: string | null;
  releasedReason: string | null;
  tokenExpired: boolean;
}

export interface RoomEvidence {
  id: string;
  requirementId: string;
  kind: "url" | "note";
  value: string;
  verification: "unverified" | "verified" | "failed";
  verificationSummary: string | null;
  submittedAt: string;
  verifiedAt: string | null;
  submittedByName: string;
}

export interface RoomFundingTx {
  id: string;
  requirementId: string;
  txHash: string;
  status: "pending" | "verified" | "rejected";
  reason: string | null;
  from: string | null;
  to: string | null;
  amount: string | null;
  blockNumber: string | null;
  blockTimestamp: string | null;
  confirmations: number | null;
  createdAt: string;
}

export interface RoomRequirement {
  id: string;
  position: number;
  title: string;
  description: string;
  kind: "commitment" | "deliverable" | "url_check" | "funding";
  mandatory: boolean;
  deadlineAt: string | null;
  dependsOn: string[];
  funding: null | {
    chainId: number;
    token: string;
    symbol: string;
    decimals: number;
    recipient: string;
    amount: string;
    minConfirmations: number;
  };
  assignments: RoomAssignment[];
  evidence: RoomEvidence[];
  fundingTxs: RoomFundingTx[];
}

export interface RoomEvent {
  id: string;
  seq: string;
  type: string;
  actorLabel: string;
  requirementId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Room {
  launch: {
    id: string;
    workspaceName: string;
    name: string;
    tagline: string;
    targetAt: string;
    decision: "proceed" | "proceed_override" | "hold" | null;
    decisionNote: string | null;
    decisionAt: string | null;
    decisionByName: string | null;
    shareToken: string | null;
    createdAt: string;
  };
  isOwner: boolean;
  viewerId: string;
  serverNow: string;
  readiness: Readiness;
  requirements: RoomRequirement[];
  events: RoomEvent[];
}

/**
 * Loads everything the Launch Room renders, evaluated against the current time. Readiness here is
 * always freshly computed, so a deadline that passed a second ago is already visible; the sweep
 * (below) persists that change to the activity log.
 */
export async function getRoom(ctx: Ctx, viewerId: string, launchId: string): Promise<Room> {
  const { isOwner } = await requireLaunchParticipant(ctx.db, viewerId, launchId);
  await sweepLaunch(ctx, launchId);
  const now = ctx.now();
  const q = ctx.db;

  const [[l], reqs, asgs, evs, txs, events, readiness] = await Promise.all([
    q.query(
      `select l.id, l.name, l.tagline, l.target_at, l.decision, l.decision_note, l.decision_at, l.share_token, l.created_at,
              w.name as workspace_name, dp.display_name as decision_by_name
       from launches l join workspaces w on w.id = l.workspace_id
       left join profiles dp on dp.id = l.decision_by
       where l.id = $1`,
      [launchId],
    ),
    q.query(
      `select id, position, title, description, kind::text as kind, mandatory, deadline_at, depends_on::text[] as depends_on,
              funding_chain_id, funding_token, funding_token_symbol, funding_token_decimals, funding_recipient,
              funding_amount::text as funding_amount, funding_min_confirmations
       from requirements where launch_id = $1 order by position, created_at, id`,
      [launchId],
    ),
    q.query(
      `select id, requirement_id, role, state::text as state, label, user_id, invited_at, accepted_at, confirmed_at, declined_at,
              decline_reason, released_at, released_reason, token_expires_at, token_hash
       from assignments where launch_id = $1 order by created_at`,
      [launchId],
    ),
    q.query(
      `select e.id, e.requirement_id, e.kind, e.value, e.verification, e.verification_detail->>'summary' as summary,
              e.submitted_at, e.verified_at, p.display_name, e.submitted_by
       from evidence e join profiles p on p.id = e.submitted_by where e.launch_id = $1 order by e.submitted_at, e.id`,
      [launchId],
    ),
    q.query(
      `select id, requirement_id, tx_hash, status, reason, from_address, to_address, amount::text as amount,
              block_number::text as block_number, block_timestamp, confirmations, created_at
       from funding_transactions where launch_id = $1 order by created_at`,
      [launchId],
    ),
    q.query(
      `select id, seq::text as seq, type, actor_label, requirement_id, payload, created_at
       from events where launch_id = $1 order by seq desc limit 80`,
      [launchId],
    ),
    evaluateLaunch(q, launchId, now),
  ]);

  const requirements: RoomRequirement[] = reqs.map((r) => ({
    id: r.id as string,
    position: r.position as number,
    title: r.title as string,
    description: r.description as string,
    kind: r.kind as RoomRequirement["kind"],
    mandatory: r.mandatory as boolean,
    deadlineAt: iso(r.deadline_at),
    dependsOn: (r.depends_on as string[] | null) ?? [],
    funding:
      r.kind === "funding"
        ? {
            chainId: r.funding_chain_id as number,
            token: r.funding_token as string,
            symbol: r.funding_token_symbol as string,
            decimals: r.funding_token_decimals as number,
            recipient: r.funding_recipient as string,
            amount: r.funding_amount as string,
            minConfirmations: r.funding_min_confirmations as number,
          }
        : null,
    assignments: asgs
      .filter((a) => a.requirement_id === r.id)
      // Contributors only see their own assignment's details plus public labels of others.
      .map((a) => ({
        id: a.id as string,
        requirementId: a.requirement_id as string,
        role: a.role as "primary" | "backup",
        state: a.state as string,
        label: a.label as string,
        isMine: a.user_id === viewerId,
        invitedAt: iso(a.invited_at),
        acceptedAt: iso(a.accepted_at),
        confirmedAt: iso(a.confirmed_at),
        declinedAt: iso(a.declined_at),
        declineReason: (a.decline_reason as string | null) ?? null,
        releasedAt: iso(a.released_at),
        releasedReason: (a.released_reason as string | null) ?? null,
        tokenExpired:
          a.token_hash !== null && a.token_expires_at instanceof Date && a.token_expires_at.getTime() < now.getTime(),
      })),
    evidence: evs
      .filter((e) => e.requirement_id === r.id && (isOwner || e.submitted_by === viewerId))
      .map((e) => ({
        id: e.id as string,
        requirementId: e.requirement_id as string,
        kind: e.kind as "url" | "note",
        value: e.value as string,
        verification: e.verification as RoomEvidence["verification"],
        verificationSummary: (e.summary as string | null) ?? null,
        submittedAt: iso(e.submitted_at)!,
        verifiedAt: iso(e.verified_at),
        submittedByName: e.display_name as string,
      })),
    fundingTxs: txs
      .filter((t) => t.requirement_id === r.id)
      .map((t) => ({
        id: t.id as string,
        requirementId: t.requirement_id as string,
        txHash: t.tx_hash as string,
        status: t.status as RoomFundingTx["status"],
        reason: (t.reason as string | null) ?? null,
        from: (t.from_address as string | null) ?? null,
        to: (t.to_address as string | null) ?? null,
        amount: (t.amount as string | null) ?? null,
        blockNumber: (t.block_number as string | null) ?? null,
        blockTimestamp: iso(t.block_timestamp),
        confirmations: (t.confirmations as number | null) ?? null,
        createdAt: iso(t.created_at)!,
      })),
  }));

  return {
    launch: {
      id: l.id as string,
      workspaceName: l.workspace_name as string,
      name: l.name as string,
      tagline: l.tagline as string,
      targetAt: iso(l.target_at)!,
      decision: (l.decision as Room["launch"]["decision"]) ?? null,
      decisionNote: (l.decision_note as string | null) ?? null,
      decisionAt: iso(l.decision_at),
      decisionByName: (l.decision_by_name as string | null) ?? null,
      shareToken: isOwner ? ((l.share_token as string | null) ?? null) : null,
      createdAt: iso(l.created_at)!,
    },
    isOwner,
    viewerId,
    serverNow: now.toISOString(),
    readiness,
    requirements,
    events: events.map((e) => ({
      id: e.id as string,
      seq: e.seq as string,
      type: e.type as string,
      actorLabel: e.actor_label as string,
      requirementId: (e.requirement_id as string | null) ?? null,
      payload: (e.payload as Record<string, unknown>) ?? {},
      createdAt: iso(e.created_at)!,
    })),
  };
}

/**
 * Persists time-driven changes. Deadlines expire without anyone clicking anything, so on every
 * read (and from a scheduled job) we compare the fresh verdict with the stored one. If they
 * differ, we record `requirement.expired` events and a `readiness.changed` event — once, thanks to
 * deterministic idempotency keys.
 */
export async function sweepLaunch(ctx: Ctx, launchId: string): Promise<void> {
  const now = ctx.now();
  const fresh = await evaluateLaunch(ctx.db, launchId, now);
  const [stored] = await ctx.db.query<{ fingerprint: string | null; decision: string | null }>(
    `select readiness_result->>'fingerprint' as fingerprint, decision from launches where id = $1`,
    [launchId],
  );
  if (!stored) return;

  const pending = await ctx.db.query(`select 1 from funding_transactions where launch_id = $1 and status = 'pending' limit 1`, [
    launchId,
  ]);
  if (pending.length > 0) {
    try {
      await reverifyFunding(ctx, launchId, null);
    } catch {
      // RPC trouble must never take the room down; the next sweep retries.
    }
  }

  if (stored.fingerprint === fresh.fingerprint) return;

  await withLaunch(ctx, launchId, { cause: "time" }, async (tx, _launch, at) => {
    const readiness = await evaluateLaunch(tx, launchId, at);
    for (const e of readiness.requirements) {
      if (e.status !== "expired" || !e.deadlineAt) continue;
      await appendEvent(tx, launchId, at, {
        type: "requirement.expired",
        actor: SYSTEM_ACTOR,
        requirementId: e.requirementId,
        idempotencyKey: `expired:${e.requirementId}:${e.deadlineAt}`,
        payload: { title: e.title, deadlineAt: e.deadlineAt, owner: e.ownerLabel, mandatory: e.mandatory },
      });
    }
  });
}

/** Scheduled entry point: sweeps every launch that has not been marked as proceeding. */
export async function sweepAll(ctx: Ctx, limit = 200) {
  const rows = await ctx.db.query<{ id: string }>(
    `select id from launches where decision is null or decision = 'hold' order by updated_at asc limit $1`,
    [limit],
  );
  let swept = 0;
  for (const r of rows) {
    try {
      await sweepLaunch(ctx, r.id);
      swept += 1;
    } catch {
      // continue with the remaining launches
    }
  }
  return { swept, total: rows.length };
}

export interface DashboardLaunch {
  id: string;
  name: string;
  workspaceName: string;
  targetAt: string;
  state: "ready" | "not_ready";
  headline: string;
  decision: string | null;
}

export interface PortalAssignment {
  assignmentId: string;
  launchId: string;
  launchName: string;
  requirementTitle: string;
  state: string;
  deadlineAt: string | null;
  role: string;
}

export async function listForUser(ctx: Ctx, userId: string) {
  const [owned, workspaces, assigned] = await Promise.all([
    ctx.db.query(
      `select l.id, l.name, l.target_at, l.readiness_state, l.readiness_result->>'headline' as headline, l.decision, w.name as workspace_name
       from launches l join workspaces w on w.id = l.workspace_id
       join workspace_members m on m.workspace_id = w.id and m.user_id = $1 and m.role = 'owner'
       order by l.target_at asc`,
      [userId],
    ),
    ctx.db.query(
      `select w.id, w.name from workspaces w join workspace_members m on m.workspace_id = w.id
       where m.user_id = $1 and m.role = 'owner' order by w.created_at`,
      [userId],
    ),
    ctx.db.query(
      `select a.id, a.launch_id, a.state::text as state, a.role, l.name as launch_name, r.title, r.deadline_at
       from assignments a join launches l on l.id = a.launch_id join requirements r on r.id = a.requirement_id
       where a.user_id = $1 and a.state <> 'released' order by r.deadline_at nulls last`,
      [userId],
    ),
  ]);
  return {
    launches: owned.map(
      (l): DashboardLaunch => ({
        id: l.id as string,
        name: l.name as string,
        workspaceName: l.workspace_name as string,
        targetAt: iso(l.target_at)!,
        state: l.readiness_state as "ready" | "not_ready",
        headline: (l.headline as string | null) ?? "NOT READY",
        decision: (l.decision as string | null) ?? null,
      }),
    ),
    workspaces: workspaces.map((w) => ({ id: w.id as string, name: w.name as string })),
    assignments: assigned.map(
      (a): PortalAssignment => ({
        assignmentId: a.id as string,
        launchId: a.launch_id as string,
        launchName: a.launch_name as string,
        requirementTitle: a.title as string,
        state: a.state as string,
        deadlineAt: iso(a.deadline_at),
        role: a.role as string,
      }),
    ),
  };
}
