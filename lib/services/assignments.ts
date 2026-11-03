import type { z } from "zod";
import type { Queryable } from "@/lib/db/types";
import { conflict, invalid, notFound } from "@/lib/errors";
import { hashToken, INVITE_TTL_MS, newInviteToken } from "@/lib/tokens";
import { declineInput, inviteInput } from "@/lib/validation";
import { requireLaunchOwner, requireOwnAssignment } from "./access";
import type { Actor, Ctx } from "./context";
import { appendEvent, asEventActor, assertNotLaunched, withLaunch } from "./core";

interface ReqInfo {
  id: string;
  launch_id: string;
  title: string;
  kind: string;
  deadline_at: Date | null;
}

async function loadRequirement(q: Queryable, requirementId: string): Promise<ReqInfo> {
  const [r] = await q.query<ReqInfo>(
    `select id, launch_id, title, kind::text as kind, deadline_at from requirements where id = $1`,
    [requirementId],
  );
  if (!r) throw notFound("Requirement not found");
  return r;
}

async function launchIdOfRequirement(ctx: Ctx, requirementId: string) {
  return (await loadRequirement(ctx.db, requirementId)).launch_id;
}

function assertAssignable(r: ReqInfo) {
  if (r.kind === "funding") throw invalid("Funding requirements are satisfied by verified transactions, not people");
}

/** The deadline must be in the future when it is being (re)set as part of a recovery. */
function assertFutureDeadline(d: Date | null | undefined, now: Date) {
  if (d && d.getTime() <= now.getTime()) throw invalid("The new deadline must be in the future");
}

async function livePrimary(q: Queryable, requirementId: string) {
  const [a] = await q.query<{ id: string; label: string; state: string }>(
    `select id, label, state::text as state from assignments
     where requirement_id = $1 and role = 'primary' and state <> 'released'`,
    [requirementId],
  );
  return a ?? null;
}

async function release(q: Queryable, assignmentId: string, now: Date, reason: string) {
  await q.query(
    `update assignments set state = 'released', released_at = $2, released_reason = $3, token_hash = null
     where id = $1`,
    [assignmentId, now, reason],
  );
}

// ── Founder actions ──────────────────────────────────────────────────────────────────────

/** Invites the responsible contributor. The returned secret is shown to the founder exactly once. */
export async function inviteContributor(
  ctx: Ctx,
  actor: Actor,
  requirementId: string,
  raw: z.input<typeof inviteInput>,
  idempotencyKey?: string,
) {
  const input = inviteInput.parse(raw);
  const launchId = await launchIdOfRequirement(ctx, requirementId);
  return withLaunch(ctx, launchId, { idempotencyKey, cause: "assignment.invited" }, async (tx, launch, now) => {
    await requireLaunchOwner(tx, actor.id, launchId);
    assertNotLaunched(launch);
    const req = await loadRequirement(tx, requirementId);
    assertAssignable(req);
    if (await livePrimary(tx, requirementId)) {
      throw conflict("This requirement already has a responsible contributor. Use Replace to change it.");
    }
    const { token, hash } = newInviteToken();
    const [a] = await tx.query<{ id: string }>(
      `insert into assignments (launch_id, requirement_id, role, label, state, token_hash, token_expires_at, invited_at, created_by)
       values ($1, $2, 'primary', $3, 'invited', $4, $5, $6, $7) returning id`,
      [launchId, requirementId, input.label, hash, new Date(now.getTime() + INVITE_TTL_MS), now, actor.id],
    );
    await appendEvent(tx, launchId, now, {
      type: "assignment.invited",
      actor: asEventActor(actor),
      requirementId,
      payload: { label: input.label, requirement: req.title },
      idempotencyKey,
    });
    return { assignmentId: a.id, token };
  });
}

/** Pre-authorises a backup. The backup receives no invitation until the founder activates them. */
export async function authoriseBackup(
  ctx: Ctx,
  actor: Actor,
  requirementId: string,
  raw: z.input<typeof inviteInput>,
  idempotencyKey?: string,
) {
  const input = inviteInput.parse(raw);
  const launchId = await launchIdOfRequirement(ctx, requirementId);
  return withLaunch(ctx, launchId, { idempotencyKey, cause: "assignment.backup_authorised" }, async (tx, launch, now) => {
    await requireLaunchOwner(tx, actor.id, launchId);
    assertNotLaunched(launch);
    const req = await loadRequirement(tx, requirementId);
    assertAssignable(req);
    const existing = await tx.query(
      `select 1 from assignments where requirement_id = $1 and role = 'backup' and state <> 'released'`,
      [requirementId],
    );
    if (existing.length > 0) throw conflict("A backup is already authorised for this requirement");
    const [a] = await tx.query<{ id: string }>(
      `insert into assignments (launch_id, requirement_id, role, label, state, created_by)
       values ($1, $2, 'backup', $3, 'standby', $4) returning id`,
      [launchId, requirementId, input.label, actor.id],
    );
    await appendEvent(tx, launchId, now, {
      type: "assignment.backup_authorised",
      actor: asEventActor(actor),
      requirementId,
      payload: { label: input.label, requirement: req.title },
      idempotencyKey,
    });
    return { assignmentId: a.id };
  });
}

/**
 * Recovery action: releases the current contributor and invites the authorised backup,
 * optionally moving the deadline. The old contributor's confirmation stops counting immediately;
 * readiness only returns once the replacement genuinely confirms.
 */
export async function activateBackup(
  ctx: Ctx,
  actor: Actor,
  requirementId: string,
  opts: { newDeadlineAt?: Date | null },
  idempotencyKey?: string,
) {
  const launchId = await launchIdOfRequirement(ctx, requirementId);
  return withLaunch(ctx, launchId, { idempotencyKey, cause: "assignment.backup_activated" }, async (tx, launch, now) => {
    await requireLaunchOwner(tx, actor.id, launchId);
    assertNotLaunched(launch);
    const req = await loadRequirement(tx, requirementId);
    assertFutureDeadline(opts.newDeadlineAt, now);
    const [backup] = await tx.query<{ id: string; label: string }>(
      `select id, label from assignments where requirement_id = $1 and role = 'backup' and state = 'standby'`,
      [requirementId],
    );
    if (!backup) throw conflict("No backup is authorised for this requirement");

    const prev = await livePrimary(tx, requirementId);
    if (prev) await release(tx, prev.id, now, "Replaced by authorised backup");

    const { token, hash } = newInviteToken();
    await tx.query(
      `update assignments set role = 'primary', state = 'invited', token_hash = $2, token_expires_at = $3, invited_at = $4
       where id = $1`,
      [backup.id, hash, new Date(now.getTime() + INVITE_TTL_MS), now],
    );
    await applyDeadline(tx, req, opts.newDeadlineAt, now);
    await appendEvent(tx, launchId, now, {
      type: "assignment.backup_activated",
      actor: asEventActor(actor),
      requirementId,
      payload: {
        requirement: req.title,
        replaced: prev?.label ?? null,
        backup: backup.label,
        newDeadlineAt: opts.newDeadlineAt?.toISOString() ?? null,
      },
      idempotencyKey,
    });
    return { assignmentId: backup.id, token, label: backup.label };
  });
}

/** Recovery action for requirements without a backup: invite someone new in place of the current owner. */
export async function replaceContributor(
  ctx: Ctx,
  actor: Actor,
  requirementId: string,
  raw: z.input<typeof inviteInput>,
  opts: { newDeadlineAt?: Date | null },
  idempotencyKey?: string,
) {
  const input = inviteInput.parse(raw);
  const launchId = await launchIdOfRequirement(ctx, requirementId);
  return withLaunch(ctx, launchId, { idempotencyKey, cause: "assignment.replaced" }, async (tx, launch, now) => {
    await requireLaunchOwner(tx, actor.id, launchId);
    assertNotLaunched(launch);
    const req = await loadRequirement(tx, requirementId);
    assertAssignable(req);
    assertFutureDeadline(opts.newDeadlineAt, now);
    const prev = await livePrimary(tx, requirementId);
    if (prev) await release(tx, prev.id, now, `Replaced by ${input.label}`);
    const { token, hash } = newInviteToken();
    const [a] = await tx.query<{ id: string }>(
      `insert into assignments (launch_id, requirement_id, role, label, state, token_hash, token_expires_at, invited_at, created_by)
       values ($1, $2, 'primary', $3, 'invited', $4, $5, $6, $7) returning id`,
      [launchId, requirementId, input.label, hash, new Date(now.getTime() + INVITE_TTL_MS), now, actor.id],
    );
    await applyDeadline(tx, req, opts.newDeadlineAt, now);
    await appendEvent(tx, launchId, now, {
      type: "assignment.replaced",
      actor: asEventActor(actor),
      requirementId,
      payload: {
        requirement: req.title,
        replaced: prev?.label ?? null,
        replacement: input.label,
        newDeadlineAt: opts.newDeadlineAt?.toISOString() ?? null,
      },
      idempotencyKey,
    });
    return { assignmentId: a.id, token };
  });
}

async function applyDeadline(tx: Queryable, req: ReqInfo, deadline: Date | null | undefined, now: Date) {
  if (deadline === undefined || deadline === null) return;
  await tx.query(`update requirements set deadline_at = $2, updated_at = $3 where id = $1`, [req.id, deadline, now]);
}

/** Issues a fresh invitation link for an unclaimed (or expired) invitation. */
export async function reissueInvitation(ctx: Ctx, actor: Actor, assignmentId: string, idempotencyKey?: string) {
  const [row] = await ctx.db.query<{ launch_id: string }>(`select launch_id from assignments where id = $1`, [
    assignmentId,
  ]);
  if (!row) throw notFound("Assignment not found");
  return withLaunch(ctx, row.launch_id, { idempotencyKey, cause: "invitation.reissued" }, async (tx, launch, now) => {
    await requireLaunchOwner(tx, actor.id, row.launch_id);
    assertNotLaunched(launch);
    const [a] = await tx.query<{ state: string; user_id: string | null; requirement_id: string; label: string }>(
      `select state::text as state, user_id, requirement_id, label from assignments where id = $1`,
      [assignmentId],
    );
    if (!a || a.state !== "invited" || a.user_id) throw conflict("Only unclaimed invitations can be re-issued");
    const { token, hash } = newInviteToken();
    await tx.query(`update assignments set token_hash = $2, token_expires_at = $3, invited_at = $4 where id = $1`, [
      assignmentId,
      hash,
      new Date(now.getTime() + INVITE_TTL_MS),
      now,
    ]);
    await appendEvent(tx, row.launch_id, now, {
      type: "invitation.reissued",
      actor: asEventActor(actor),
      requirementId: a.requirement_id,
      payload: { label: a.label },
      idempotencyKey,
    });
    return { token };
  });
}

export async function releaseContributor(ctx: Ctx, actor: Actor, assignmentId: string, idempotencyKey?: string) {
  const [row] = await ctx.db.query<{ launch_id: string }>(`select launch_id from assignments where id = $1`, [
    assignmentId,
  ]);
  if (!row) throw notFound("Assignment not found");
  return withLaunch(ctx, row.launch_id, { idempotencyKey, cause: "assignment.released" }, async (tx, launch, now) => {
    await requireLaunchOwner(tx, actor.id, row.launch_id);
    assertNotLaunched(launch);
    const [a] = await tx.query<{ state: string; requirement_id: string; label: string }>(
      `select state::text as state, requirement_id, label from assignments where id = $1`,
      [assignmentId],
    );
    if (!a || a.state === "released") throw conflict("Already released");
    await release(tx, assignmentId, now, "Released by founder");
    await appendEvent(tx, row.launch_id, now, {
      type: "assignment.released",
      actor: asEventActor(actor),
      requirementId: a.requirement_id,
      payload: { label: a.label },
      idempotencyKey,
    });
  });
}

// ── Contributor actions ──────────────────────────────────────────────────────────────────

export interface InvitationPreview {
  assignmentId: string;
  launchName: string;
  requirementTitle: string;
  requirementDescription: string;
  deadlineAt: Date | null;
  invitedBy: string;
  label: string;
  state: string;
  expired: boolean;
  claimedByOther: boolean;
}

/** Looks an invitation up by its secret. Returns null for unknown secrets. */
export async function previewInvitation(ctx: Ctx, token: string, viewerId: string | null): Promise<InvitationPreview | null> {
  const rows = await ctx.db.query(
    `select a.id, a.label, a.state::text as state, a.user_id, a.token_expires_at,
            l.name as launch_name, r.title, r.description, r.deadline_at, p.display_name as inviter
     from assignments a
     join launches l on l.id = a.launch_id
     join requirements r on r.id = a.requirement_id
     join profiles p on p.id = a.created_by
     where a.token_hash = $1`,
    [hashToken(token)],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    assignmentId: r.id as string,
    launchName: r.launch_name as string,
    requirementTitle: r.title as string,
    requirementDescription: r.description as string,
    deadlineAt: (r.deadline_at as Date | null) ?? null,
    invitedBy: r.inviter as string,
    label: r.label as string,
    state: r.state as string,
    expired: (r.token_expires_at as Date).getTime() < ctx.now().getTime(),
    claimedByOther: r.user_id !== null && r.user_id !== viewerId,
  };
}

async function claimByToken(
  ctx: Ctx,
  actor: Actor,
  token: string,
  idempotencyKey: string | undefined,
  outcome: "accept" | "decline",
  reason: string,
) {
  const [found] = await ctx.db.query<{ launch_id: string }>(`select launch_id from assignments where token_hash = $1`, [
    hashToken(token),
  ]);
  if (!found) throw notFound("This invitation link is invalid or has already been used");

  return withLaunch(ctx, found.launch_id, { idempotencyKey, cause: `assignment.${outcome}ed` }, async (tx, launch, now) => {
    assertNotLaunched(launch);
    // Re-read under the launch lock: of two people racing for one link, exactly one wins.
    const [a] = await tx.query<{
      id: string;
      state: string;
      user_id: string | null;
      requirement_id: string;
      label: string;
      created_by: string;
      token_expires_at: Date;
    }>(
      `select id, state::text as state, user_id, requirement_id, label, created_by, token_expires_at
       from assignments where token_hash = $1`,
      [hashToken(token)],
    );
    if (!a) throw notFound("This invitation link is invalid or has already been used");
    if (a.state !== "invited") throw conflict("This invitation has already been answered");
    if (a.user_id && a.user_id !== actor.id) throw conflict("This invitation was claimed by someone else");
    if (a.token_expires_at.getTime() < now.getTime()) {
      throw conflict("This invitation has expired. Ask the founder to send a new one.");
    }
    if (a.created_by === actor.id) {
      throw invalid("You issued this invitation. Contributors must respond from their own account.");
    }

    if (outcome === "accept") {
      await tx.query(
        `update assignments set user_id = $2, state = 'accepted', accepted_at = $3, token_hash = null where id = $1`,
        [a.id, actor.id, now],
      );
      await tx.query(
        `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'contributor')
         on conflict do nothing`,
        [launch.workspaceId, actor.id],
      );
    } else {
      await tx.query(
        `update assignments set user_id = $2, state = 'declined', declined_at = $3, decline_reason = $4, token_hash = null
         where id = $1`,
        [a.id, actor.id, now, reason],
      );
    }
    await appendEvent(tx, found.launch_id, now, {
      type: outcome === "accept" ? "assignment.accepted" : "assignment.declined",
      actor: asEventActor(actor),
      requirementId: a.requirement_id,
      payload: { label: a.label, ...(reason ? { reason } : {}) },
      idempotencyKey,
    });
    return { assignmentId: a.id, launchId: found.launch_id };
  });
}

export const acceptInvitation = (ctx: Ctx, actor: Actor, token: string, idempotencyKey?: string) =>
  claimByToken(ctx, actor, token, idempotencyKey, "accept", "");

export const declineInvitation = (
  ctx: Ctx,
  actor: Actor,
  token: string,
  raw: z.input<typeof declineInput>,
  idempotencyKey?: string,
) => claimByToken(ctx, actor, token, idempotencyKey, "decline", declineInput.parse(raw).reason);

/** Confirms the commitment. Only the assignee themselves can do this. */
export async function confirmCommitment(ctx: Ctx, actor: Actor, assignmentId: string, idempotencyKey?: string) {
  const own = await requireOwnAssignment(ctx.db, actor.id, assignmentId);
  return withLaunch(ctx, own.launch_id, { idempotencyKey, cause: "assignment.confirmed" }, async (tx, launch, now) => {
    assertNotLaunched(launch);
    const a = await requireOwnAssignment(tx, actor.id, assignmentId);
    if (a.state !== "accepted") {
      throw conflict(a.state === "confirmed" ? "You have already confirmed this commitment" : `Cannot confirm from state "${a.state}"`);
    }
    if (a.role !== "primary") throw conflict("Only the active contributor can confirm");
    await tx.query(`update assignments set state = 'confirmed', confirmed_at = $2 where id = $1`, [assignmentId, now]);
    await appendEvent(tx, a.launch_id, now, {
      type: "assignment.confirmed",
      actor: asEventActor(actor),
      requirementId: a.requirement_id,
      payload: { label: a.label },
      idempotencyKey,
    });
  });
}

/** A contributor who can no longer deliver steps down. This immediately blocks the requirement. */
export async function withdrawCommitment(
  ctx: Ctx,
  actor: Actor,
  assignmentId: string,
  raw: z.input<typeof declineInput>,
  idempotencyKey?: string,
) {
  const reason = declineInput.parse(raw).reason;
  const own = await requireOwnAssignment(ctx.db, actor.id, assignmentId);
  return withLaunch(ctx, own.launch_id, { idempotencyKey, cause: "assignment.withdrawn" }, async (tx, launch, now) => {
    assertNotLaunched(launch);
    const a = await requireOwnAssignment(tx, actor.id, assignmentId);
    if (a.state !== "accepted" && a.state !== "confirmed") throw conflict(`Cannot withdraw from state "${a.state}"`);
    await tx.query(
      `update assignments set state = 'declined', declined_at = $2, decline_reason = $3 where id = $1`,
      [assignmentId, now, reason || "Withdrew availability"],
    );
    await appendEvent(tx, a.launch_id, now, {
      type: "assignment.declined",
      actor: asEventActor(actor),
      requirementId: a.requirement_id,
      payload: { label: a.label, reason: reason || "Withdrew availability", withdrawn: true },
      idempotencyKey,
    });
  });
}
