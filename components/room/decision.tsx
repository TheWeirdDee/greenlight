"use client";

import Link from "next/link";
import { useState } from "react";
import { recordDecisionAction } from "@/app/actions";
import type { Room } from "@/lib/services/room";
import { Button, Card, ErrorNote, Eyebrow, Field, Textarea } from "../ui";
import { buttonClass } from "../button-class";
import { useAct } from "../use-act";

/** The founder's call. Greenlight reports readiness; it never launches, approves payments or overrides anything. */
export function Decision({ room }: { room: Room }) {
  const { act, pending, error } = useAct();
  const [note, setNote] = useState("");
  const [override, setOverride] = useState(false);
  const ready = room.readiness.state === "ready";
  const d = room.launch.decision;
  const proceeding = d === "proceed" || d === "proceed_override";

  return (
    <Card className="p-5 sm:p-6">
      <Eyebrow>Founder decision</Eyebrow>
      <h2 className="mt-1 font-display text-2xl">{proceeding ? "Decision recorded" : "Your call"}</h2>
      <p className="mt-2 text-[15px] text-ink-2">
        Greenlight tells you whether the recorded conditions are met. It cannot guarantee anyone will deliver what they promised, and it never approves or sends funds.
      </p>

      {proceeding ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm">
            Proceeding is recorded{d === "proceed_override" ? " as an override with open blockers" : ""}. The room is locked against edits. Revert to hold to change anything.
          </p>
          <Button variant="secondary" busy={pending} onClick={() => act((k) => recordDecisionAction(room.launch.id, { decision: "hold", note: "", overrideAcknowledged: false }, k))}>
            Revert to hold
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <Field label={ready ? "Note (optional)" : "Why proceed despite open blockers?"} hint={ready ? undefined : "Required for an override. It appears verbatim in the brief next to the list of unresolved blockers."}>
            {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
          </Field>
          {!ready ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={override} onChange={(e) => setOverride(e.target.checked)} />
              <span>I understand this launch is <strong>not ready</strong>. Record my decision as an override.</span>
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              busy={pending}
              disabled={!ready && !override}
              onClick={() => act((k) => recordDecisionAction(room.launch.id, { decision: "proceed", note, overrideAcknowledged: override }, k))}
            >
              {ready ? "Proceed with launch" : "Proceed anyway (override)"}
            </Button>
            <Button variant="secondary" busy={pending} onClick={() => act((k) => recordDecisionAction(room.launch.id, { decision: "hold", note, overrideAcknowledged: false }, k))}>
              Hold
            </Button>
            <Link href={`/app/launches/${room.launch.id}/brief`} className={buttonClass("ghost")}>View brief</Link>
          </div>
        </div>
      )}
      <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
    </Card>
  );
}
