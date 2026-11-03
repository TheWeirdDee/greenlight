"use client";

import Link from "next/link";
import { useState } from "react";
import { recordDecisionAction } from "@/app/actions";
import type { Room } from "@/lib/services/room";
import { buttonClass } from "../button-class";
import { Button, Card, ErrorNote, Eyebrow, Field, Textarea } from "../ui";
import { useAct } from "../use-act";

/** The founder's call. Greenlight reports readiness; it never launches, approves payments or overrides anything. */
export function Decision({ room }: { room: Room }) {
  const { act, pending, error } = useAct();
  const [note, setNote] = useState("");
  const [override, setOverride] = useState(false);
  const ready = room.readiness.state === "ready";
  const d = room.launch.decision;
  const proceeding = d === "proceed" || d === "proceed_override";
  const open = room.readiness.blockers.length;

  return (
    <Card className="scroll-mt-20 p-5 sm:p-6" id="decision">
      <Eyebrow>Founder decision</Eyebrow>
      <h2 className="mt-1 font-display text-2xl">{proceeding ? "Decision recorded" : ready ? "Everything is satisfied" : "Not cleared yet"}</h2>

      {proceeding ? (
        <div className="mt-3 space-y-3">
          <p className="text-[15px] text-ink-2">
            You decided to proceed{d === "proceed_override" ? ", as an override with open blockers" : ""}. The room is locked against edits; revert to hold to change anything.
          </p>
          <Button variant="secondary" busy={pending} onClick={() => act((k) => recordDecisionAction(room.launch.id, { decision: "hold", note: "", overrideAcknowledged: false }, k))}>
            Revert to hold
          </Button>
        </div>
      ) : ready ? (
        <div className="mt-3 space-y-4">
          <p className="text-[15px] text-ink-2">
            Every mandatory requirement is satisfied by recorded evidence. Greenlight can&apos;t guarantee anyone will deliver what they promised, and it never sends or approves funds — the decision is yours.
          </p>
          <Field label="Note (optional)">{(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}</Field>
          <div className="flex flex-wrap gap-2">
            <Button busy={pending} onClick={() => act((k) => recordDecisionAction(room.launch.id, { decision: "proceed", note, overrideAcknowledged: false }, k))}>
              Proceed with launch
            </Button>
            <Button variant="secondary" busy={pending} onClick={() => act((k) => recordDecisionAction(room.launch.id, { decision: "hold", note, overrideAcknowledged: false }, k))}>
              Hold
            </Button>
            <Link href={`/app/launches/${room.launch.id}/brief`} className={buttonClass("ghost")}>View brief</Link>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          <p className="text-[15px] text-ink-2">
            {open > 0 ? `${open} ${open === 1 ? "blocker is" : "blockers are"} still open.` : "Add mandatory requirements first."} Resolve {open === 1 ? "it" : "them"} and this panel unlocks by itself.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" busy={pending} onClick={() => act((k) => recordDecisionAction(room.launch.id, { decision: "hold", note: "", overrideAcknowledged: false }, k))}>
              Put launch on hold
            </Button>
            <Link href={`/app/launches/${room.launch.id}/brief`} className={buttonClass("ghost")}>View brief</Link>
          </div>
          <details className="rounded-xl border border-line bg-paper p-3">
            <summary className="cursor-pointer text-sm font-medium text-ink-2">Proceed anyway (recorded override)…</summary>
            <div className="mt-3 space-y-3">
              <p className="text-[13px] text-ink-3">Greenlight will still say NOT READY. Your reason and the exact list of open blockers are stored in the brief with a timestamp.</p>
              <Field label="Why proceed despite open blockers?" hint="At least 10 characters.">
                {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                <span>I understand this launch is <strong>not ready</strong>. Record my decision as an override.</span>
              </label>
              <Button variant="danger" busy={pending} disabled={!override || note.trim().length < 10} onClick={() => act((k) => recordDecisionAction(room.launch.id, { decision: "proceed", note, overrideAcknowledged: override }, k))}>
                Proceed anyway
              </Button>
            </div>
          </details>
        </div>
      )}
      <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
    </Card>
  );
}
