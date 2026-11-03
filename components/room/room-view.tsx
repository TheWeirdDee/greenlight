"use client";

import { useMemo, useState } from "react";
import type { Room } from "@/lib/services/room";
import { EmptyState } from "../ui";
import { Activity } from "./activity";
import { AddRequirement } from "./add-requirement";
import { BlockerList } from "./blockers";
import { Decision } from "./decision";
import { Hero } from "./hero";
import { InviteBanner } from "./invite-banner";
import type { IssuedInvite } from "./recovery";
import { RequirementCard } from "./requirement-card";

export function RoomView({ room }: { room: Room }) {
  const [issued, setIssued] = useState<IssuedInvite | null>(null);
  const deadlines = useMemo(() => room.requirements.map((r) => r.deadlineAt).filter((d): d is string => Boolean(d)), [room.requirements]);
  const evalById = new Map(room.readiness.requirements.map((e) => [e.requirementId, e]));
  const frozen = room.launch.decision === "proceed" || room.launch.decision === "proceed_override";

  return (
    <div className="space-y-6">
      <Hero room={room} deadlines={deadlines} />
      <nav aria-label="Jump to a section" className="-mt-2 flex flex-wrap gap-2 lg:hidden">
        {[
          ["#blockers", "Blockers"],
          ["#requirement-list", "Requirements"],
          ...(room.isOwner ? [["#decision", "Decision"]] : []),
          ["#activity", "Activity"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink-2 hover:bg-sunken hover:text-ink">
            {label}
          </a>
        ))}
      </nav>
      {issued ? <InviteBanner invite={issued} launchName={room.launch.name} onDismiss={() => setIssued(null)} /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <BlockerList room={room} onIssued={setIssued} />
          {room.isOwner && !frozen ? <AddRequirement launchId={room.launch.id} existing={room.requirements} /> : null}
          <section aria-label="Requirements" id="requirement-list" className="scroll-mt-20 space-y-4">
            {room.requirements.length === 0 ? (
              <EmptyState title="No requirements yet">
                {room.isOwner ? "Add the conditions that must be true before you launch: commitments, deliverables, site checks and funding." : "The founder hasn't added requirements yet."}
              </EmptyState>
            ) : (
              room.requirements.map((req) => {
                const ev = evalById.get(req.id);
                return ev ? <RequirementCard key={req.id} room={room} req={req} ev={ev} onIssued={setIssued} /> : null;
              })
            )}
          </section>
        </div>
        <div className="min-w-0 space-y-6">
          {room.isOwner ? <Decision room={room} /> : null}
          <Activity room={room} />
        </div>
      </div>
    </div>
  );
}
