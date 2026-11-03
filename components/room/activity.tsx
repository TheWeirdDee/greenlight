"use client";

import { describeEvent } from "@/lib/activity";
import { fmtDateTime } from "@/lib/format";
import type { Room } from "@/lib/services/room";
import { Card, Eyebrow } from "../ui";

const dot = {
  ready: "bg-[var(--ready-lamp)]",
  wait: "bg-[var(--wait-lamp)]",
  block: "bg-[var(--block-lamp)]",
  expired: "bg-[var(--expired)]",
  neutral: "bg-[var(--line-strong)]",
} as const;

export function Activity({ room }: { room: Room }) {
  return (
    <Card className="p-5 sm:p-6">
      <Eyebrow>Activity</Eyebrow>
      <h2 className="mt-1 font-display text-2xl">Every change, with who and when</h2>
      <ol className="mt-4 space-y-0">
        {room.events.map((e) => {
          const d = describeEvent(e, room.requirements);
          return (
            <li key={e.id} className="relative flex gap-3 pb-4 pl-0 last:pb-0">
              <span aria-hidden="true" className="relative mt-1.5 flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                <span className={`h-2.5 w-2.5 rounded-full ${dot[d.tone]}`} />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] leading-snug">
                  <span className="font-medium">{e.actorLabel}</span> <span className="break-words text-ink-2">{d.text}</span>
                </p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  <time dateTime={e.createdAt}>{fmtDateTime(e.createdAt)}</time>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
