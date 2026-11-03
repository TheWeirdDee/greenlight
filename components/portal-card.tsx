"use client";

import Link from "next/link";
import { confirmCommitmentAction } from "@/app/actions";
import { fmtDateTime } from "@/lib/format";
import type { PortalAssignment } from "@/lib/services/room";
import { Pill } from "./status";
import { Button, Card, ErrorNote } from "./ui";
import { buttonClass } from "./button-class";
import { useAct } from "./use-act";

const text: Record<string, { tone: "ready" | "wait" | "block" | "neutral"; label: string }> = {
  invited: { tone: "wait", label: "Awaiting your response" },
  accepted: { tone: "wait", label: "Accepted — please confirm" },
  confirmed: { tone: "ready", label: "Confirmed" },
  declined: { tone: "block", label: "Declined / stepped down" },
};

export function PortalCard({ a }: { a: PortalAssignment }) {
  const { act, pending, error } = useAct();
  const s = text[a.state] ?? { tone: "neutral" as const, label: a.state };
  return (
    <Card as="div" className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-3">{a.launchName}</p>
          <h2 className="mt-0.5 break-words text-lg font-medium leading-snug">{a.requirementTitle}</h2>
        </div>
        <Pill tone={s.tone}>{s.label}</Pill>
      </div>
      <p className="mt-2 text-sm text-ink-2">Deadline: {a.deadlineAt ? fmtDateTime(a.deadlineAt) : "none"}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {a.state === "accepted" ? <Button busy={pending} onClick={() => act((k) => confirmCommitmentAction(a.assignmentId, k))}>Confirm commitment</Button> : null}
        <Link href={`/app/launches/${a.launchId}`} className={buttonClass("secondary")}>Open launch room</Link>
      </div>
      <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>
    </Card>
  );
}
