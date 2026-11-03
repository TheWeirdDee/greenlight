import type { z } from "zod";
import type { Queryable } from "@/lib/db/types";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { assertWithinRate } from "@/lib/rate-limit";
import { evidenceInput } from "@/lib/validation";
import type { Actor, Ctx } from "./context";
import { appendEvent, asEventActor, assertNotLaunched, withLaunch } from "./core";

interface ReqRow {
  id: string;
  launch_id: string;
  title: string;
  kind: string;
  [key: string]: unknown;
}

async function actorStanding(q: Queryable, actor: Actor, launchId: string, requirementId: string) {
  const [s] = await q.query<{ is_owner: boolean; assignment_id: string | null; assignment_state: string | null }>(
    `select
       exists (select 1 from launches l join workspace_members m on m.workspace_id = l.workspace_id
               where l.id = $1 and m.user_id = $2 and m.role = 'owner') as is_owner,
       (select a.id from assignments a where a.requirement_id = $3 and a.user_id = $2 and a.role = 'primary'
          and a.state in ('accepted', 'confirmed')) as assignment_id,
       (select a.state::text from assignments a where a.requirement_id = $3 and a.user_id = $2 and a.role = 'primary'
          and a.state in ('accepted', 'confirmed')) as assignment_state`,
    [launchId, actor.id, requirementId],
  );
  return s;
}

/**
 * Records evidence for a requirement.
 *  - deliverable: only the confirmed, active contributor may submit (the founder cannot supply
 *    evidence on a contributor's behalf).
 *  - url_check: the active contributor or the founder may submit a URL; Greenlight itself then
 *    fetches it. The submitter's say-so never marks it verified.
 *  - commitment / funding: no free-form evidence.
 */
export async function submitEvidence(
  ctx: Ctx,
  actor: Actor,
  requirementId: string,
  raw: z.input<typeof evidenceInput>,
  idempotencyKey?: string,
) {
  const input = evidenceInput.parse(raw);
  // Site checks make an outbound request from our server: throttle them per person.
  if (input.kind === "url") assertWithinRate(`url:${actor.id}`, 12, 60_000, ctx.now());
  const [req] = await ctx.db.query<ReqRow>(`select id, launch_id, title, kind::text as kind from requirements where id = $1`, [
    requirementId,
  ]);
  if (!req) throw notFound("Requirement not found");

  const outcome = await withLaunch(ctx, req.launch_id, { idempotencyKey, cause: "evidence.submitted" }, async (tx, launch, now) => {
    assertNotLaunched(launch);
    const standing = await actorStanding(tx, actor, req.launch_id, requirementId);
    if (!standing.is_owner && !standing.assignment_id) throw notFound("Requirement not found");

    if (req.kind === "deliverable") {
      if (standing.assignment_state !== "confirmed") {
        throw forbidden("Only the confirmed contributor can submit evidence for this deliverable");
      }
    } else if (req.kind === "url_check") {
      if (input.kind !== "url") throw invalid("Availability checks need a URL");
    } else {
      throw invalid("This requirement does not take submitted evidence");
    }

    const [ev] = await tx.query<{ id: string }>(
      `insert into evidence (launch_id, requirement_id, assignment_id, submitted_by, kind, value, submitted_at)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [req.launch_id, requirementId, standing.assignment_id, actor.id, input.kind, input.value, now],
    );
    await appendEvent(tx, req.launch_id, now, {
      type: "evidence.submitted",
      actor: asEventActor(actor),
      requirementId,
      payload: { kind: input.kind, value: input.kind === "url" ? input.value : "(note)", requirement: req.title },
      idempotencyKey,
    });
    return { evidenceId: ev.id };
  });

  if (outcome.duplicate) return { duplicate: true as const };
  if (req.kind === "url_check") await runUrlCheck(ctx, outcome.value.evidenceId);
  return { duplicate: false as const, evidenceId: outcome.value.evidenceId };
}

/**
 * Fetches the submitted URL from the server and records the outcome. This is the only code path
 * that can mark URL evidence verified. The network call happens outside any database lock.
 */
export async function runUrlCheck(ctx: Ctx, evidenceId: string) {
  const [ev] = await ctx.db.query<{ launch_id: string; requirement_id: string; value: string; kind: string }>(
    `select launch_id, requirement_id, value, kind from evidence where id = $1`,
    [evidenceId],
  );
  if (!ev || ev.kind !== "url") throw notFound("Evidence not found");

  const result = await ctx.urlChecker.check(ev.value);

  await withLaunch(ctx, ev.launch_id, { cause: "evidence.checked" }, async (tx, _launch, now) => {
    const updated = await tx.query(
      `update evidence set verification = $2, verified_at = $3, verification_detail = $4::jsonb
       where id = $1 and verification = 'unverified' returning id`,
      [
        evidenceId,
        result.ok ? "verified" : "failed",
        now,
        { summary: result.summary, status: result.status, finalUrl: result.finalUrl },
      ],
    );
    if (updated.length === 0) throw conflict("This check has already been recorded");
    await appendEvent(tx, ev.launch_id, now, {
      type: result.ok ? "evidence.verified" : "evidence.failed",
      actor: { id: null, label: "Greenlight" },
      requirementId: ev.requirement_id,
      payload: { url: ev.value, summary: result.summary, status: result.status },
    });
  });
  return result;
}

/** Re-runs the availability check by recording the latest URL again as fresh evidence. */
export async function recheckUrl(ctx: Ctx, actor: Actor, requirementId: string) {
  const [latest] = await ctx.db.query<{ value: string }>(
    `select value from evidence where requirement_id = $1 and kind = 'url' order by submitted_at desc, id desc limit 1`,
    [requirementId],
  );
  if (!latest) throw invalid("No URL has been submitted yet");
  return submitEvidence(ctx, actor, requirementId, { kind: "url", value: latest.value });
}
