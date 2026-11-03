"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import {
  authoriseBackupAction,
  confirmCommitmentAction,
  inviteAction,
  reissueInvitationAction,
  releaseContributorAction,
  recheckUrlAction,
  removeRequirementAction,
  submitEvidenceAction,
  updateRequirementAction,
  withdrawCommitmentAction,
} from "@/app/actions";
import { fmtDateTime } from "@/lib/format";
import { safeHref } from "@/lib/safe-url";
import type { RequirementEvaluation } from "@/lib/readiness/types";
import type { Room, RoomAssignment, RoomRequirement } from "@/lib/services/room";
import { Pill, StatusPill, TierBadge } from "../status";
import { Button, Card, ErrorNote, Field, Input, Select, Textarea } from "../ui";
import { useAct } from "../use-act";
import type { IssuedInvite } from "./recovery";
import { isoToLocal, localToIso } from "@/lib/format";

const FundingPanel = dynamic(() => import("../funding-panel").then((m) => m.FundingPanel), {
  ssr: false,
  loading: () => <p className="mt-4 text-sm text-ink-3">Loading wallet tools…</p>,
});

const kindLabel = { commitment: "Commitment", deliverable: "Deliverable", url_check: "Site check", funding: "Funding" } as const;

const assignmentText: Record<string, { tone: "ready" | "wait" | "block" | "neutral"; text: string }> = {
  standby: { tone: "neutral", text: "Backup on standby" },
  invited: { tone: "wait", text: "Invited — awaiting response" },
  accepted: { tone: "wait", text: "Accepted — awaiting confirmation" },
  confirmed: { tone: "ready", text: "Confirmed" },
  declined: { tone: "block", text: "Declined / unavailable" },
  released: { tone: "neutral", text: "Released" },
};

export function RequirementCard({
  room,
  req,
  ev,
  onIssued,
}: {
  room: Room;
  req: RoomRequirement;
  ev: RequirementEvaluation;
  onIssued: (i: IssuedInvite) => void;
}) {
  const frozen = room.launch.decision === "proceed" || room.launch.decision === "proceed_override";
  const primary = req.assignments.find((a) => a.role === "primary" && a.state !== "released");
  const backup = req.assignments.find((a) => a.role === "backup" && a.state === "standby");
  const mine = req.assignments.find((a) => a.isMine && a.role === "primary" && a.state !== "released" && a.state !== "declined");
  const deps = req.dependsOn.map((d) => room.requirements.find((r) => r.id === d)?.title).filter(Boolean);

  return (
    <Card as="article" className="scroll-mt-20 p-4 sm:p-5" id={`req-${req.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">{kindLabel[req.kind]}</span>
            {!req.mandatory ? <span className="rounded border border-line-strong px-1.5 py-0.5 text-[11px] text-ink-3">Optional</span> : null}
            <TierBadge tier={ev.evidenceTier} />
          </div>
          <h3 className="mt-1 break-words text-lg font-medium leading-snug">{req.title}</h3>
          {req.description ? <p className="mt-1 text-[15px] text-ink-2">{req.description}</p> : null}
        </div>
        <StatusPill status={ev.status} />
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-ink-3">Deadline</dt>
          <dd>{req.deadlineAt ? fmtDateTime(req.deadlineAt) : "None"}</dd>
        </div>
        {deps.length > 0 ? (
          <div className="flex gap-2">
            <dt className="text-ink-3">Depends on</dt>
            <dd>{deps.join(", ")}</dd>
          </div>
        ) : null}
        {ev.satisfiedAt ? (
          <div className="flex gap-2">
            <dt className="text-ink-3">Satisfied</dt>
            <dd>{fmtDateTime(ev.satisfiedAt)}</dd>
          </div>
        ) : null}
      </dl>

      {ev.status !== "satisfied" && ev.reasons.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-ink-2">
          {ev.reasons.map((r, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true" className="text-ink-3">›</span>
              {r.message}
            </li>
          ))}
        </ul>
      ) : null}

      {req.kind !== "funding" ? (
        <OwnerSection room={room} req={req} primary={primary} backup={backup} frozen={frozen} onIssued={onIssued} />
      ) : (
        <FundingPanel requirement={req} verifiedUnits={ev.progress?.current ?? "0"} frozen={frozen} />
      )}

      {mine && !frozen ? <ContributorControls req={req} mine={mine} /> : null}
      {(req.kind === "url_check" || req.kind === "deliverable") && !frozen ? (
        <EvidenceSection room={room} req={req} mine={mine} />
      ) : null}
      {req.evidence.length > 0 ? <EvidenceList req={req} /> : null}
      {room.isOwner && !frozen ? <FounderEdit room={room} req={req} /> : null}
    </Card>
  );
}

function OwnerSection({
  room,
  req,
  primary,
  backup,
  frozen,
  onIssued,
}: {
  room: Room;
  req: RoomRequirement;
  primary: RoomAssignment | undefined;
  backup: RoomAssignment | undefined;
  frozen: boolean;
  onIssued: (i: IssuedInvite) => void;
}) {
  const { act, pending, error } = useAct();
  const [label, setLabel] = useState("");
  const [backupLabel, setBackupLabel] = useState("");
  const issued = (l: string) => (d: { value?: { token: string } }) => {
    if (d.value?.token) onIssued({ label: l, token: d.value.token, requirementTitle: req.title });
  };

  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-[12px] uppercase tracking-wider text-ink-3">Responsible</p>
      {primary ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-medium">{primary.label}</span>
          <Pill tone={assignmentText[primary.state].tone}>{assignmentText[primary.state].text}</Pill>
          {primary.confirmedAt ? <span className="text-[13px] text-ink-3">{fmtDateTime(primary.confirmedAt)}</span> : null}
          {primary.declineReason ? <span className="text-[13px] text-ink-2">“{primary.declineReason}”</span> : null}
          {room.isOwner && !frozen ? (
            <span className="ml-auto flex gap-2">
              {primary.state === "invited" ? (
                <Button variant="ghost" size="sm" busy={pending} onClick={() => act((k) => reissueInvitationAction(primary.id, k), (d) => d.value && onIssued({ label: primary.label, token: d.value.token, requirementTitle: req.title }))}>
                  {primary.tokenExpired ? "Re-issue expired link" : "New link"}
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" busy={pending} onClick={() => confirm(`Release ${primary.label} from this requirement?`) && act((k) => releaseContributorAction(primary.id, k))}>
                Release
              </Button>
            </span>
          ) : null}
        </div>
      ) : (
        <p className="mt-1 text-sm text-block">Nobody assigned yet.</p>
      )}

      {backup ? (
        <p className="mt-2 text-sm text-ink-2">
          Authorised backup: <span className="font-medium text-ink">{backup.label}</span> (no invitation sent until you activate them)
        </p>
      ) : null}

      {room.isOwner && !frozen && !primary ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            act((k) => inviteAction(req.id, label, k), (d) => { issued(label)(d); setLabel(""); });
          }}
        >
          <div className="min-w-0 flex-1 basis-52">
            <Field label="Invite a contributor">
              {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} required placeholder="Name or handle" />}
            </Field>
          </div>
          <Button type="submit" size="sm" busy={pending}>Create invitation</Button>
        </form>
      ) : null}

      {room.isOwner && !frozen && primary && !backup ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            act((k) => authoriseBackupAction(req.id, backupLabel, k), () => setBackupLabel(""));
          }}
        >
          <div className="min-w-0 flex-1 basis-52">
            <Field label="Authorise a backup (optional)" hint="Enables one-click recovery if the owner goes quiet.">
              {(p) => <Input {...p} value={backupLabel} onChange={(e) => setBackupLabel(e.target.value)} maxLength={120} required placeholder="Name or handle" />}
            </Field>
          </div>
          <Button type="submit" size="sm" variant="secondary" busy={pending}>Add backup</Button>
        </form>
      ) : null}
      <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>
    </div>
  );
}

function ContributorControls({ req, mine }: { req: RoomRequirement; mine: RoomAssignment }) {
  const { act, pending, error } = useAct();
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4 rounded-xl border border-[var(--focus)]/40 bg-paper p-4">
      <p className="text-sm font-medium">Your commitment</p>
      {mine.state === "accepted" ? (
        <>
          <p className="mt-1 text-sm text-ink-2">You accepted this. Until you confirm, it does not count toward readiness.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button busy={pending} onClick={() => act((k) => confirmCommitmentAction(mine.id, k))}>Confirm I&apos;ll deliver this</Button>
            <Button variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>I can&apos;t do this</Button>
          </div>
        </>
      ) : null}
      {mine.state === "confirmed" ? (
        <>
          <p className="mt-1 text-sm text-ready">You confirmed on {fmtDateTime(mine.confirmedAt)}.</p>
          <div className="mt-3">
            <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>No longer available?</Button>
          </div>
        </>
      ) : null}
      {open ? (
        <div className="mt-3 space-y-3">
          <Field label="What happened?" hint="Your team sees this reason. The requirement becomes blocked immediately so they can find a replacement.">
            {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}
          </Field>
          <Button variant="danger" busy={pending} onClick={() => act((k) => withdrawCommitmentAction(mine.id, reason, k), () => setOpen(false))}>
            Step down from “{req.title}”
          </Button>
        </div>
      ) : null}
      <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>
    </div>
  );
}

function EvidenceSection({ room, req, mine }: { room: Room; req: RoomRequirement; mine: RoomAssignment | undefined }) {
  const { act, pending, error } = useAct();
  const [kind, setKind] = useState<"url" | "note">(req.kind === "url_check" ? "url" : "url");
  const [value, setValue] = useState("");

  const canSubmit = req.kind === "url_check" ? room.isOwner || Boolean(mine) : mine?.state === "confirmed";
  if (!canSubmit) {
    return req.kind === "deliverable" && room.isOwner ? (
      <p className="mt-3 text-sm text-ink-3">Evidence for this deliverable can only be submitted by its confirmed contributor.</p>
    ) : null;
  }
  const hasUrl = req.evidence.some((e) => e.kind === "url");

  return (
    <div className="mt-4 border-t border-line pt-3">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          act((k) => submitEvidenceAction(req.id, { kind, value }, k), () => setValue(""));
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          {req.kind === "deliverable" ? (
            <div className="w-32">
              <Field label="Type">{(p) => <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as "url" | "note")}><option value="url">Link</option><option value="note">Note</option></Select>}</Field>
            </div>
          ) : null}
          <div className="min-w-0 flex-1 basis-64">
            <Field
              label={req.kind === "url_check" ? "Public URL to check" : kind === "url" ? "Evidence link" : "Evidence note"}
              hint={req.kind === "url_check" ? "Greenlight fetches this from its own server. Your claim alone never satisfies the check." : "Recorded as a submitted claim with your name and time — not independently verified."}
            >
              {(p) => <Input {...p} value={value} onChange={(e) => setValue(e.target.value)} required maxLength={2000} type={kind === "url" ? "url" : "text"} placeholder={kind === "url" ? "https://…" : "What was delivered?"} />}
            </Field>
          </div>
          <Button type="submit" size="sm" busy={pending}>{req.kind === "url_check" ? "Check site" : "Submit evidence"}</Button>
          {req.kind === "url_check" && hasUrl ? <RecheckButton requirementId={req.id} /> : null}
        </div>
        <ErrorNote>{error}</ErrorNote>
      </form>
    </div>
  );
}

function RecheckButton({ requirementId }: { requirementId: string }) {
  const { act, pending } = useAct();
  return (
    <Button type="button" variant="secondary" size="sm" busy={pending} onClick={() => act(() => recheckUrlAction(requirementId))}>
      Re-run last check
    </Button>
  );
}

function EvidenceList({ req }: { req: RoomRequirement }) {
  return (
    <details className="mt-4 text-sm" open>
      <summary className="cursor-pointer text-ink-2">Evidence history ({req.evidence.length})</summary>
      <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
        {[...req.evidence].reverse().map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
            <span className="min-w-0 break-all">
              {e.kind === "url" && safeHref(e.value) ? <a className="underline underline-offset-2" href={safeHref(e.value)} target="_blank" rel="noreferrer noopener">{e.value}</a> : e.value}
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-2 text-[12px] text-ink-3">
              {e.submittedByName} · {fmtDateTime(e.submittedAt)}
              {e.verification === "verified" ? <Pill tone="ready">Verified{e.verificationSummary ? `: ${e.verificationSummary}` : ""}</Pill> : null}
              {e.verification === "failed" ? <Pill tone="block">Failed{e.verificationSummary ? `: ${e.verificationSummary}` : ""}</Pill> : null}
              {e.verification === "unverified" ? <Pill tone="neutral">Unchecked claim</Pill> : null}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function FounderEdit({ room, req }: { room: Room; req: RoomRequirement }) {
  const { act, pending, error } = useAct();
  const [title, setTitle] = useState(req.title);
  const [description, setDescription] = useState(req.description);
  const [mandatory, setMandatory] = useState(req.mandatory);
  const [deadline, setDeadline] = useState(isoToLocal(req.deadlineAt));
  const [deps, setDeps] = useState<string[]>(req.dependsOn);
  const others = room.requirements.filter((r) => r.id !== req.id);

  return (
    <details className="mt-4 border-t border-line pt-3">
      <summary className="cursor-pointer text-sm text-ink-2">Edit requirement</summary>
      <form
        className="mt-3 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          act((k) => updateRequirementAction(req.id, { title, description, mandatory, deadlineAt: deadline ? localToIso(deadline) : null, dependsOn: deps }, k));
        }}
      >
        <Field label="Title">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={140} />}</Field>
        <Field label="Description">{(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />}</Field>
        <Field label="Deadline" hint="Your local time. Leave empty for no deadline.">{(p) => <Input {...p} type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />}</Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} className="h-4 w-4" />
          Mandatory for launch readiness
        </label>
        {others.length > 0 ? (
          <fieldset>
            <legend className="text-sm font-medium">Depends on</legend>
            <div className="mt-1.5 space-y-1.5">
              {others.map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={deps.includes(o.id)} onChange={(e) => setDeps(e.target.checked ? [...deps, o.id] : deps.filter((d) => d !== o.id))} />
                  {o.title}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" busy={pending}>Save changes</Button>
          <Button type="button" variant="danger" size="sm" busy={pending} onClick={() => confirm(`Remove “${req.title}”? This also removes its evidence.`) && act((k) => removeRequirementAction(req.id, k))}>
            Remove
          </Button>
        </div>
        <ErrorNote>{error}</ErrorNote>
      </form>
    </details>
  );
}
