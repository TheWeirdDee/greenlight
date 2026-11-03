"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { fmtDateTime } from "@/lib/format";
import type { Room } from "@/lib/services/room";
import { Countdown } from "../countdown";
import { lampFor, Pill, SignalLamps } from "../status";
import { buttonClass } from "../button-class";
import { LiveRefresh } from "./live";

export function Hero({ room, deadlines }: { room: Room; deadlines: string[] }) {
  const reduce = useReducedMotion();
  const { readiness: r, launch } = room;
  const lit = lampFor(r.state, r.counts.blockedOrExpired);
  const ready = r.state === "ready";
  const tone = ready ? "text-ready" : r.counts.blockedOrExpired > 0 ? "text-block" : "text-wait";

  return (
    <section aria-labelledby="status-heading" className="rounded-3xl border border-line bg-surface p-5 shadow-[var(--shadow)] sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">
            {launch.workspaceName} · Launch room
          </p>
          <h1 className="mt-1 break-words font-display text-3xl leading-tight sm:text-4xl">{launch.name}</h1>
          {launch.tagline ? <p className="mt-1 max-w-xl text-[15px] text-ink-2">{launch.tagline}</p> : null}
          <p className="mt-2 text-sm text-ink-3">
            Target {fmtDateTime(launch.targetAt)}
          </p>
        </div>
        <Countdown targetIso={launch.targetAt} serverNowIso={room.serverNow} />
      </div>

      <div className="mt-6 flex items-center gap-4 sm:gap-6">
        <SignalLamps lit={lit} size={reduce ? 18 : 20} live={!ready} />
        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.h2
              key={r.headline}
              id="status-heading"
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className={`font-display text-[clamp(1.6rem,6.2vw,3.25rem)] font-semibold leading-[1.05] ${tone}`}
              aria-live="polite"
            >
              {r.headline}
            </motion.h2>
          </AnimatePresence>
          <p className="mt-2 text-[15px] text-ink-2">{r.detail}</p>
        </div>
      </div>

      {launch.decision ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-sunken px-4 py-3 text-sm">
          <Pill tone={launch.decision === "hold" ? "wait" : launch.decision === "proceed" ? "ready" : "block"}>
            {launch.decision === "hold" ? "On hold" : launch.decision === "proceed" ? "Founder: proceed" : "Founder: proceed (override)"}
          </Pill>
          <span className="text-ink-2">
            {launch.decisionByName} · {fmtDateTime(launch.decisionAt)}
          </span>
          {launch.decisionNote ? <span className="text-ink-2">— “{launch.decisionNote}”</span> : null}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <LiveRefresh launchId={launch.id} deadlines={deadlines} />
        {room.isOwner ? (
          <div className="flex flex-wrap gap-2">
            <Link href={`/app/launches/${launch.id}/settings`} className={buttonClass("secondary", "sm")}>
              Edit launch
            </Link>
            <Link href={`/app/launches/${launch.id}/brief`} className={buttonClass("primary", "sm")}>
              Readiness brief
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}
