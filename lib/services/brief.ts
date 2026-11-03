import type { z } from "zod";
import type { Queryable } from "@/lib/db/types";
import { conflict, invalid, notFound } from "@/lib/errors";
import type { Readiness } from "@/lib/readiness/types";
import { newShareToken } from "@/lib/tokens";
import { decisionInput } from "@/lib/validation";
import { BASE_SEPOLIA_CHAIN_ID, txUrl } from "@/lib/chain/config";
import { requireLaunchOwner } from "./access";
import type { Actor, Ctx } from "./context";
import { appendEvent, asEventActor, evaluateLaunch, withLaunch } from "./core";
import { sweepLaunch } from "./room";

/**
 * The Launch Readiness Brief. Every item is tagged with how it is known:
 *  - "verified": established by Greenlight itself (on-chain check, server-side URL fetch);
 *  - "submitted": a claim or attestation by an authenticated person — Greenlight records who and
 *    when, but has not independently checked it.
 */
export interface Brief {
  generatedAt: string;
  launch: { id: string; name: string; tagline: string; targetAt: string; workspaceName: string };
  readiness: Pick<Readiness, "state" | "headline" | "detail" | "counts" | "evaluatedAt">;
  requirements: BriefRequirement[];
  blockers: Array<{ title: string; severity: string; summary: string; owner: string | null; next: string; deadlineAt: string | null }>;
  contributors: Array<{ name: string; requirement: string; role: string; state: string; confirmedAt: string | null }>;
  funding: Array<{
    requirement: string;
    symbol: string;
    target: string;
    verified: string;
    recipient: string;
    chainId: number;
    transactions: Array<{
      txHash: string;
      explorerUrl: string;
      status: string;
      amount: string | null;
      from: string | null;
      blockNumber: string | null;
      blockTimestamp: string | null;
      confirmations: number | null;
    }>;
  }>;
  decision: null | {
    decision: "proceed" | "proceed_override" | "hold";
    note: string | null;
    decidedAt: string;
    decidedBy: string;
    unresolvedAtDecision: string[];
  };
}

export interface BriefRequirement {
  title: string;
  kind: string;
  mandatory: boolean;
  status: string;
  owner: string | null;
  deadlineAt: string | null;
  satisfiedAt: string | null;
  reasons: string[];
  evidenceTier: "none" | "submitted" | "verified";
  evidence: Array<{
    kind: "url" | "note";
    /** Note bodies are withheld from public briefs. */
    value: string | null;
    knownAs: "verified" | "submitted" | "failed";
    submittedBy: string;
    submittedAt: string;
    summary: string | null;
  }>;
}

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));

export async function buildBrief(q: Queryable, launchId: string, now: Date, opts: { redactNotes: boolean }): Promise<Brief> {
  const [launchRows, readiness] = await Promise.all([
    q.query(
      `select l.id, l.name, l.tagline, l.target_at, l.decision, l.decision_note, l.decision_at, l.decision_snapshot,
              w.name as workspace_name, p.display_name as decided_by
       from launches l join workspaces w on w.id = l.workspace_id left join profiles p on p.id = l.decision_by
       where l.id = $1`,
      [launchId],
    ),
    evaluateLaunch(q, launchId, now),
  ]);
  const l = launchRows[0];
  if (!l) throw notFound("Launch not found");

  const [reqs, asgs, evs, txs] = await Promise.all([
    q.query(
      `select id, title, kind::text as kind, funding_token_symbol, funding_token_decimals, funding_recipient,
              funding_amount::text as funding_amount, funding_chain_id
       from requirements where launch_id = $1`,
      [launchId],
    ),
    q.query(
      `select requirement_id, role, state::text as state, label, confirmed_at from assignments
       where launch_id = $1 and state <> 'released' and state <> 'standby' order by created_at`,
      [launchId],
    ),
    q.query(
      `select e.requirement_id, e.kind, e.value, e.verification, e.verification_detail->>'summary' as summary,
              e.submitted_at, p.display_name
       from evidence e join profiles p on p.id = e.submitted_by where e.launch_id = $1 order by e.submitted_at`,
      [launchId],
    ),
    q.query(
      `select requirement_id, tx_hash, status, amount::text as amount, from_address, block_number::text as block_number,
              block_timestamp, confirmations
       from funding_transactions where launch_id = $1 and status <> 'rejected' order by created_at`,
      [launchId],
    ),
  ]);
  const reqById = new Map(reqs.map((r) => [r.id as string, r]));

  const requirements: BriefRequirement[] = readiness.requirements.map((e) => ({
    title: e.title,
    kind: e.kind,
    mandatory: e.mandatory,
    status: e.status,
    owner: e.ownerLabel,
    deadlineAt: e.deadlineAt,
    satisfiedAt: e.satisfiedAt,
    reasons: e.reasons.map((r) => r.message),
    evidenceTier: e.evidenceTier,
    evidence: evs
      .filter((x) => x.requirement_id === e.requirementId)
      .map((x) => ({
        kind: x.kind as "url" | "note",
        value: x.kind === "note" && opts.redactNotes ? null : (x.value as string),
        knownAs: x.verification === "verified" ? ("verified" as const) : x.verification === "failed" ? ("failed" as const) : ("submitted" as const),
        submittedBy: x.display_name as string,
        submittedAt: iso(x.submitted_at)!,
        summary: (x.summary as string | null) ?? null,
      })),
  }));

  const funding: Brief["funding"] = readiness.requirements
    .filter((e) => e.kind === "funding")
    .map((e) => {
      const r = reqById.get(e.requirementId)!;
      return {
        requirement: e.title,
        symbol: (r.funding_token_symbol as string) ?? "",
        target: (r.funding_amount as string) ?? "0",
        verified: e.progress?.current ?? "0",
        recipient: r.funding_recipient as string,
        chainId: (r.funding_chain_id as number) ?? BASE_SEPOLIA_CHAIN_ID,
        transactions: txs
          .filter((t) => t.requirement_id === e.requirementId)
          .map((t) => ({
            txHash: t.tx_hash as string,
            explorerUrl: txUrl(t.tx_hash as string),
            status: t.status as string,
            amount: (t.amount as string | null) ?? null,
            from: (t.from_address as string | null) ?? null,
            blockNumber: (t.block_number as string | null) ?? null,
            blockTimestamp: iso(t.block_timestamp),
            confirmations: (t.confirmations as number | null) ?? null,
          })),
      };
    });

  const titleOf = new Map(reqs.map((r) => [r.id as string, r.title as string]));
  const snapshot = l.decision_snapshot as { unresolved?: string[] } | null;

  return {
    generatedAt: now.toISOString(),
    launch: {
      id: l.id as string,
      name: l.name as string,
      tagline: l.tagline as string,
      targetAt: iso(l.target_at)!,
      workspaceName: l.workspace_name as string,
    },
    readiness: {
      state: readiness.state,
      headline: readiness.headline,
      detail: readiness.detail,
      counts: readiness.counts,
      evaluatedAt: readiness.evaluatedAt,
    },
    requirements,
    blockers: readiness.blockers.map((b) => ({
      title: b.title,
      severity: b.severity,
      summary: b.summary,
      owner: b.ownerLabel,
      next: b.next.label,
      deadlineAt: b.deadlineAt,
    })),
    contributors: asgs.map((a) => ({
      name: a.label as string,
      requirement: titleOf.get(a.requirement_id as string) ?? "",
      role: a.role as string,
      state: a.state as string,
      confirmedAt: iso(a.confirmed_at),
    })),
    funding,
    decision: l.decision
      ? {
          decision: l.decision as "proceed" | "proceed_override" | "hold",
          note: (l.decision_note as string | null) ?? null,
          decidedAt: iso(l.decision_at)!,
          decidedBy: (l.decided_by as string | null) ?? "Founder",
          unresolvedAtDecision: snapshot?.unresolved ?? [],
        }
      : null,
  };
}

/**
 * Records the founder's decision. Deterministic logic decides readiness; the human decides whether
 * to act on it. "Proceed" while NOT READY is allowed only as an explicit, labelled override that
 * stores exactly which blockers were open at that moment.
 */
export async function recordDecision(
  ctx: Ctx,
  actor: Actor,
  launchId: string,
  raw: z.input<typeof decisionInput>,
  idempotencyKey?: string,
) {
  const input = decisionInput.parse(raw);
  await requireLaunchOwner(ctx.db, actor.id, launchId);
  await sweepLaunch(ctx, launchId); // make sure time-driven changes are on record before deciding

  return withLaunch(ctx, launchId, { idempotencyKey, cause: "launch.decision" }, async (tx, _launch, now) => {
    await requireLaunchOwner(tx, actor.id, launchId);
    const readiness = await evaluateLaunch(tx, launchId, now);

    let decision: "proceed" | "proceed_override" | "hold" = input.decision;
    const unresolved = readiness.blockers.map((b) => b.title);
    if (input.decision === "proceed" && readiness.state !== "ready") {
      if (!input.overrideAcknowledged) {
        throw conflict(
          `The launch is not ready (${readiness.headline.toLowerCase()}). Acknowledge the override to proceed anyway.`,
        );
      }
      if (input.note.length < 10) throw invalid("Explain why you are proceeding despite open blockers (at least 10 characters).");
      decision = "proceed_override";
    }

    const brief = await buildBrief(tx, launchId, now, { redactNotes: true });
    await tx.query(
      `update launches set decision = $2, decision_note = $3, decision_at = $4, decision_by = $5, decision_snapshot = $6::jsonb
       where id = $1`,
      [launchId, decision, input.note || null, now, actor.id, { unresolved, brief }],
    );
    await appendEvent(tx, launchId, now, {
      type: "launch.decision",
      actor: asEventActor(actor),
      payload: { decision, note: input.note || null, readiness: readiness.state, unresolved },
      idempotencyKey,
    });
    return { decision };
  });
}

export async function createShareLink(ctx: Ctx, actor: Actor, launchId: string) {
  return withLaunch(ctx, launchId, { cause: "share.created" }, async (tx, _l, now) => {
    await requireLaunchOwner(tx, actor.id, launchId);
    const token = newShareToken();
    await tx.query(`update launches set share_token = $2 where id = $1`, [launchId, token]);
    await appendEvent(tx, launchId, now, { type: "share.created", actor: asEventActor(actor) });
    return { token };
  });
}

export async function revokeShareLink(ctx: Ctx, actor: Actor, launchId: string) {
  return withLaunch(ctx, launchId, { cause: "share.revoked" }, async (tx, _l, now) => {
    await requireLaunchOwner(tx, actor.id, launchId);
    await tx.query(`update launches set share_token = null where id = $1`, [launchId]);
    await appendEvent(tx, launchId, now, { type: "share.revoked", actor: asEventActor(actor) });
  });
}

/** Public, read-only brief addressed by an unguessable token. Notes are redacted. */
export async function getSharedBrief(ctx: Ctx, token: string): Promise<Brief | null> {
  const [row] = await ctx.db.query<{ id: string }>(`select id from launches where share_token = $1`, [token]);
  if (!row) return null;
  await sweepLaunch(ctx, row.id);
  return buildBrief(ctx.db, row.id, ctx.now(), { redactNotes: true });
}

/** The founder's own view of the brief (notes included). */
export async function getOwnerBrief(ctx: Ctx, actor: Actor, launchId: string): Promise<Brief> {
  await requireLaunchOwner(ctx.db, actor.id, launchId);
  await sweepLaunch(ctx, launchId);
  return buildBrief(ctx.db, launchId, ctx.now(), { redactNotes: false });
}

/** The brief exactly as it stood when the founder decided. */
export async function getDecisionSnapshot(ctx: Ctx, token: string): Promise<Brief | null> {
  const [row] = await ctx.db.query<{ decision_snapshot: { brief?: Brief } | null }>(
    `select decision_snapshot from launches where share_token = $1`,
    [token],
  );
  return row?.decision_snapshot?.brief ?? null;
}
