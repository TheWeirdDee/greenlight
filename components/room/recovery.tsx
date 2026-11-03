"use client";

import { useState } from "react";
import { activateBackupAction, inviteAction, replaceContributorAction, updateRequirementAction } from "@/app/actions";
import { isoToLocal, localToIso } from "@/lib/format";
import type { RoomRequirement } from "@/lib/services/room";
import { Button, ErrorNote, Field, Input } from "../ui";
import { useAct } from "../use-act";

export interface IssuedInvite {
  label: string;
  token: string;
  requirementTitle: string;
}

const inHours = (h: number) => isoToLocal(new Date(Date.now() + h * 3_600_000).toISOString());

/**
 * The authorised recovery actions for a stuck requirement. Each is a deliberate founder action that
 * lands in the activity log; none of them marks anything satisfied — the replacement must still
 * genuinely accept and confirm before readiness changes.
 */
export function Recovery({
  req,
  nextCode,
  backupLabel,
  onIssued,
}: {
  req: RoomRequirement;
  nextCode: string;
  backupLabel: string | null;
  onIssued: (i: IssuedInvite) => void;
}) {
  const { act, pending, error } = useAct();
  const [deadline, setDeadline] = useState(() => inHours(24));
  const [label, setLabel] = useState("");
  const deadlineIso = () => localToIso(deadline) || null;

  const issued = (l: string) => (d: { value?: { token: string } }) => {
    if (d.value?.token) onIssued({ label: l, token: d.value.token, requirementTitle: req.title });
  };

  if (nextCode === "assign_owner") {
    return (
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          act((k) => inviteAction(req.id, label, k), issued(label));
        }}
      >
        <div className="min-w-0 flex-1 basis-56">
          <Field label="Who is responsible?" hint="A name or handle; you'll get a private invitation link.">
            {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={120} placeholder="e.g. Ada — partnerships" />}
          </Field>
        </div>
        <Button type="submit" busy={pending}>Create invitation</Button>
        <div className="w-full"><ErrorNote>{error}</ErrorNote></div>
      </form>
    );
  }

  const canExtend = nextCode === "activate_backup" || nextCode === "replace_or_extend" || nextCode === "extend_deadline";
  if (!canExtend) return null;

  return (
    <div className="space-y-3 rounded-xl border border-line-strong bg-paper p-3 sm:p-4">
      <p className="text-sm font-medium">Recovery</p>
      <Field label="New deadline" hint="Your local time. Must be in the future.">
        {(p) => <Input {...p} type="datetime-local" value={deadline} min={inHours(0)} onChange={(e) => setDeadline(e.target.value)} />}
      </Field>

      {nextCode === "activate_backup" && backupLabel ? (
        <Button
          busy={pending}
          onClick={() => act((k) => activateBackupAction(req.id, deadlineIso(), k), issued(backupLabel))}
        >
          Activate {backupLabel} &amp; set deadline
        </Button>
      ) : null}

      {nextCode === "replace_or_extend" ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-52">
            <Field label="Replacement contributor">
              {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="Name or handle" />}
            </Field>
          </div>
          <Button busy={pending} disabled={!label.trim()} onClick={() => act((k) => replaceContributorAction(req.id, label, deadlineIso(), k), issued(label))}>
            Replace &amp; invite
          </Button>
        </div>
      ) : null}

      {nextCode !== "activate_backup" ? (
        <Button
          variant="secondary"
          busy={pending}
          onClick={() => act((k) => updateRequirementAction(req.id, { deadlineAt: deadlineIso() }, k))}
        >
          Extend deadline only
        </Button>
      ) : null}
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
