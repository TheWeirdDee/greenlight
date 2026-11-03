"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import type { Room } from "@/lib/services/room";
import { Pill, severityTone, TierBadge } from "../status";
import { Card, Eyebrow } from "../ui";
import { Recovery, type IssuedInvite } from "./recovery";

const severityLabel = { expired: "Expired", blocked: "Blocked", waiting: "Waiting" } as const;

export function BlockerList({ room, onIssued }: { room: Room; onIssued: (i: IssuedInvite) => void }) {
  const reduce = useReducedMotion();
  const { blockers } = room.readiness;
  const nowMs = new Date(room.serverNow).getTime();

  return (
    <Card className="scroll-mt-20 p-5 sm:p-6" id="blockers">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <Eyebrow>What&apos;s stopping the launch</Eyebrow>
          <h2 className="mt-1 font-display text-2xl">{blockers.length === 0 ? "Nothing is blocking this launch" : `${blockers.length} ${blockers.length === 1 ? "blocker" : "blockers"}`}</h2>
        </div>
      </div>

      {blockers.length === 0 ? (
        <p className="mt-3 text-[15px] text-ink-2">
          {room.readiness.state === "ready"
            ? "Every mandatory requirement is satisfied by recorded evidence. The decision is yours."
            : "Add mandatory requirements to start tracking readiness."}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          <AnimatePresence initial={false}>
            {blockers.map((b) => {
              const req = room.requirements.find((r) => r.id === b.requirementId)!;
              const backup = req.assignments.find((a) => a.role === "backup" && a.state === "standby");
              return (
                <motion.li
                  key={b.requirementId}
                  layout={!reduce}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, x: -16 }}
                  transition={{ duration: 0.25 }}
                  className="rounded-xl border border-line bg-paper p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={severityTone(b.severity)}>{severityLabel[b.severity]}</Pill>
                    <h3 className="font-medium">{b.title}</h3>
                    <TierBadge tier={b.evidenceTier} />
                  </div>
                  <p className="mt-2 text-[15px] text-ink-2">{b.summary}</p>
                  <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-[12px] uppercase tracking-wider text-ink-3">Responsible</dt>
                      <dd>{b.ownerLabel ?? <span className="text-block">Nobody assigned</span>}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] uppercase tracking-wider text-ink-3">Deadline</dt>
                      <dd>{b.deadlineAt ? <>{fmtDateTime(b.deadlineAt)} <span className="text-ink-3">({fmtRelative(b.deadlineAt, nowMs)})</span></> : "None"}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] uppercase tracking-wider text-ink-3">Next action</dt>
                      <dd className="font-medium">{b.next.label}</dd>
                    </div>
                  </dl>
                  {room.isOwner && !room.launch.decision?.startsWith("proceed") ? (
                    <div className="mt-3">
                      {b.next.code === "assign_owner" ? (
                        <a href={`#req-${req.id}`} className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4">
                          Assign someone in the requirement below ↓
                        </a>
                      ) : (
                        <Recovery req={req} nextCode={b.next.code} backupLabel={backup?.label ?? null} onIssued={onIssued} />
                      )}
                    </div>
                  ) : null}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </Card>
  );
}
