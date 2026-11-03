import { shortHash } from "@/lib/format";
import type { RoomEvent, RoomRequirement } from "@/lib/services/room";

type Tone = "ready" | "wait" | "block" | "expired" | "neutral";

/** Turns a raw event into a sentence for the activity log. */
export function describeEvent(e: RoomEvent, requirements: RoomRequirement[]): { text: string; tone: Tone } {
  const p = e.payload as Record<string, string | number | boolean | null | undefined | Array<{ title: string }>>;
  const title = (requirements.find((r) => r.id === e.requirementId)?.title ?? (p.title as string) ?? (p.requirement as string) ?? "a requirement") as string;
  const q = `“${title}”`;
  switch (e.type) {
    case "launch.created":
      return { text: "created the launch", tone: "neutral" };
    case "launch.updated":
      return { text: "updated the launch details", tone: "neutral" };
    case "requirement.added":
      return { text: `added the requirement ${q}`, tone: "neutral" };
    case "requirement.updated":
      return { text: `edited ${q}`, tone: "neutral" };
    case "requirement.removed":
      return { text: `removed the requirement ${q}`, tone: "neutral" };
    case "assignment.invited":
      return { text: `invited ${p.label} to own ${q}`, tone: "wait" };
    case "assignment.accepted":
      return { text: `accepted ${q}`, tone: "wait" };
    case "assignment.confirmed":
      return { text: `confirmed their commitment to ${q}`, tone: "ready" };
    case "assignment.declined":
      return { text: `${p.withdrawn ? "withdrew from" : "declined"} ${q}${p.reason ? ` — “${p.reason}”` : ""}`, tone: "block" };
    case "assignment.backup_authorised":
      return { text: `authorised ${p.label} as backup for ${q}`, tone: "neutral" };
    case "assignment.backup_activated":
      return { text: `activated backup ${p.backup}${p.replaced ? ` in place of ${p.replaced}` : ""} for ${q}`, tone: "wait" };
    case "assignment.replaced":
      return { text: `replaced ${p.replaced ?? "the owner"} with ${p.replacement} on ${q}`, tone: "wait" };
    case "assignment.released":
      return { text: `released ${p.label} from ${q}`, tone: "neutral" };
    case "invitation.reissued":
      return { text: `re-issued the invitation for ${p.label}`, tone: "neutral" };
    case "evidence.submitted":
      return { text: p.kind === "url" ? `submitted ${p.value} for ${q}` : `submitted a note for ${q}`, tone: "wait" };
    case "evidence.verified":
      return { text: `site check passed for ${q}: ${p.summary}`, tone: "ready" };
    case "evidence.failed":
      return { text: `site check failed for ${q}: ${p.summary}`, tone: "block" };
    case "funding.verified":
      return { text: `funding transaction ${shortHash(String(p.txHash))} verified on-chain`, tone: "ready" };
    case "funding.pending":
      return { text: `funding transaction ${shortHash(String(p.txHash))} recorded, awaiting confirmations`, tone: "wait" };
    case "funding.rejected":
      return { text: `transaction ${shortHash(String(p.txHash))} was rejected: ${p.reason}`, tone: "block" };
    case "requirement.expired":
      return { text: `${q} missed its deadline`, tone: "expired" };
    case "readiness.changed": {
      const to = p.to === "ready" ? "READY" : "NOT READY";
      const blockers = (p.blockers as Array<{ title: string }> | undefined) ?? [];
      return {
        text: `readiness recalculated → ${to}${blockers.length ? ` (${blockers.length} blocker${blockers.length === 1 ? "" : "s"})` : ""}`,
        tone: p.to === "ready" ? "ready" : "neutral",
      };
    }
    case "launch.decision":
      return {
        text:
          p.decision === "hold"
            ? "placed the launch on hold"
            : p.decision === "proceed_override"
              ? "decided to proceed despite open blockers"
              : "decided to proceed with the launch",
        tone: p.decision === "hold" ? "wait" : "ready",
      };
    case "share.created":
      return { text: "created a public brief link", tone: "neutral" };
    case "share.revoked":
      return { text: "revoked the public brief link", tone: "neutral" };
    default:
      return { text: e.type, tone: "neutral" };
  }
}
