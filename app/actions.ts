"use server";

import { revalidatePath } from "next/cache";
import { run, unwrap, type ActionResult } from "@/lib/server/action";
import {
  acceptInvitation,
  activateBackup,
  authoriseBackup,
  confirmCommitment,
  declineInvitation,
  inviteContributor,
  reissueInvitation,
  releaseContributor,
  replaceContributor,
  withdrawCommitment,
} from "@/lib/services/assignments";
import { createShareLink, recordDecision, revokeShareLink } from "@/lib/services/brief";
import { recheckUrl, submitEvidence } from "@/lib/services/evidence";
import { reverifyFunding, submitFundingTx } from "@/lib/services/funding";
import {
  addRequirement,
  createLaunch,
  createWorkspace,
  removeRequirement,
  updateLaunch,
  updateRequirement,
} from "@/lib/services/launches";
import { invalid } from "@/lib/errors";
import { requirementInput } from "@/lib/validation";
import type { z } from "zod";

const refresh = () => revalidatePath("/", "layout");
const asDate = (s: string | null | undefined) => {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw invalid("Invalid date");
  return d;
};

// ── Founder ──────────────────────────────────────────────────────────────────────────────

export async function createWorkspaceAction(name: string) {
  return run((u, ctx) => createWorkspace(ctx, u, { name }));
}

export async function createLaunchAction(workspaceId: string, input: { name: string; tagline: string; targetAt: string }) {
  return run((u, ctx) => createLaunch(ctx, u, workspaceId, input));
}

export async function updateLaunchAction(launchId: string, input: { name: string; tagline: string; targetAt: string }, key: string) {
  const r = await run(async (u, ctx) => unwrap(await updateLaunch(ctx, u, launchId, input, key)));
  refresh();
  return r;
}

export async function addRequirementAction(launchId: string, input: z.input<typeof requirementInput>, key: string) {
  const r = await run(async (u, ctx) => unwrap(await addRequirement(ctx, u, launchId, input, key)));
  refresh();
  return r;
}

export async function updateRequirementAction(
  requirementId: string,
  patch: { title?: string; description?: string; mandatory?: boolean; deadlineAt?: string | null; dependsOn?: string[] },
  key: string,
) {
  const r = await run(async (u, ctx) =>
    unwrap(
      await updateRequirement(
        ctx,
        u,
        requirementId,
        { ...patch, deadlineAt: patch.deadlineAt === undefined ? undefined : asDate(patch.deadlineAt) },
        key,
      ),
    ),
  );
  refresh();
  return r;
}

export async function removeRequirementAction(requirementId: string, key: string) {
  const r = await run(async (u, ctx) => unwrap(await removeRequirement(ctx, u, requirementId, key)));
  refresh();
  return r;
}

export async function inviteAction(requirementId: string, label: string, key: string) {
  const r = await run(async (u, ctx) => unwrap(await inviteContributor(ctx, u, requirementId, { label }, key)));
  refresh();
  return r;
}

export async function authoriseBackupAction(requirementId: string, label: string, key: string) {
  const r = await run(async (u, ctx) => unwrap(await authoriseBackup(ctx, u, requirementId, { label }, key)));
  refresh();
  return r;
}

export async function activateBackupAction(requirementId: string, newDeadlineAt: string | null, key: string) {
  const r = await run(async (u, ctx) =>
    unwrap(await activateBackup(ctx, u, requirementId, { newDeadlineAt: asDate(newDeadlineAt) }, key)),
  );
  refresh();
  return r;
}

export async function replaceContributorAction(requirementId: string, label: string, newDeadlineAt: string | null, key: string) {
  const r = await run(async (u, ctx) =>
    unwrap(await replaceContributor(ctx, u, requirementId, { label }, { newDeadlineAt: asDate(newDeadlineAt) }, key)),
  );
  refresh();
  return r;
}

export async function reissueInvitationAction(assignmentId: string, key: string) {
  const r = await run(async (u, ctx) => unwrap(await reissueInvitation(ctx, u, assignmentId, key)));
  refresh();
  return r;
}

export async function releaseContributorAction(assignmentId: string, key: string) {
  const r = await run(async (u, ctx) => unwrap(await releaseContributor(ctx, u, assignmentId, key)));
  refresh();
  return r;
}

export async function recordDecisionAction(
  launchId: string,
  input: { decision: "proceed" | "hold"; note: string; overrideAcknowledged: boolean },
  key: string,
) {
  const r = await run(async (u, ctx) => unwrap(await recordDecision(ctx, u, launchId, input, key)));
  refresh();
  return r;
}

export async function createShareAction(launchId: string) {
  const r = await run(async (u, ctx) => unwrap(await createShareLink(ctx, u, launchId)));
  refresh();
  return r;
}

export async function revokeShareAction(launchId: string) {
  const r = await run(async (u, ctx) => unwrap(await revokeShareLink(ctx, u, launchId)));
  refresh();
  return r;
}

export async function refreshFundingAction(launchId: string) {
  const r = await run((u, ctx) => reverifyFunding(ctx, launchId, u));
  refresh();
  return r;
}

// ── Contributor ──────────────────────────────────────────────────────────────────────────

export async function acceptInvitationAction(token: string, key: string) {
  const r = await run(async (u, ctx) => unwrap(await acceptInvitation(ctx, u, token, key)));
  refresh();
  return r;
}

export async function declineInvitationAction(token: string, reason: string, key: string) {
  const r = await run(async (u, ctx) => unwrap(await declineInvitation(ctx, u, token, { reason }, key)));
  refresh();
  return r;
}

export async function confirmCommitmentAction(assignmentId: string, key: string) {
  const r = await run(async (u, ctx) => unwrap(await confirmCommitment(ctx, u, assignmentId, key)));
  refresh();
  return r;
}

export async function withdrawCommitmentAction(assignmentId: string, reason: string, key: string) {
  const r = await run(async (u, ctx) => unwrap(await withdrawCommitment(ctx, u, assignmentId, { reason }, key)));
  refresh();
  return r;
}

export async function submitEvidenceAction(
  requirementId: string,
  input: { kind: "url" | "note"; value: string },
  key: string,
) {
  const r = await run((u, ctx) => submitEvidence(ctx, u, requirementId, input, key));
  refresh();
  return r;
}

export async function recheckUrlAction(requirementId: string) {
  const r = await run((u, ctx) => recheckUrl(ctx, u, requirementId));
  refresh();
  return r;
}

export async function submitFundingTxAction(requirementId: string, txHash: string, key: string) {
  const r = await run((u, ctx) => submitFundingTx(ctx, u, requirementId, txHash, key));
  refresh();
  return r;
}

export type { ActionResult };
