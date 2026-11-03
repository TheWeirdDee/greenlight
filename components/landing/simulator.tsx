"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo, useReducer } from "react";
import { evaluateReadiness } from "@/lib/readiness/engine";
import type { EngineInput } from "@/lib/readiness/types";
import { lampFor, Pill, severityTone, SignalLamps, StatusPill, TierBadge } from "../status";
import { Button } from "../ui";

/**
 * An interactive sample of the product's core idea. It runs the *same* `evaluateReadiness` function
 * the server uses, over illustrative data. Nothing here is a real launch or a real transaction.
 */

const T0 = new Date("2026-11-08T12:00:00Z").getTime();
const H = 3_600_000;
const at = (h: number) => new Date(T0 + h * H);

type S = {
  hours: number;
  ada: "invited" | "accepted" | "confirmed" | "declined" | "released";
  grace: "standby" | "invited" | "confirmed";
  adaAt: number;
  graceAt: number;
  funded: number; // in whole USDC
  site: "none" | "verified" | "failed";
  log: string[];
};

const initial: S = { hours: 0, ada: "invited", grace: "standby", adaAt: 0, graceAt: 0, funded: 0, site: "none", log: [] };

type A =
  | { t: "ada_confirms" }
  | { t: "ada_steps_down" }
  | { t: "fund"; usdc: number }
  | { t: "site"; ok: boolean }
  | { t: "deadline_passes" }
  | { t: "activate_backup" }
  | { t: "grace_confirms" }
  | { t: "reset" };

function reduce(s: S, a: A): S {
  const note = (m: string): S["log"] => [m, ...s.log].slice(0, 5);
  switch (a.t) {
    case "ada_confirms":
      {
      const hours = Math.max(s.hours, 1);
      return { ...s, ada: "confirmed", hours, adaAt: hours, log: note(hours > 6 ? "Ada confirmed — but after the deadline" : "Ada accepted and confirmed") };
    }
    case "ada_steps_down":
      return { ...s, ada: "declined", log: note("Ada stepped down: “Family emergency”") };
    case "fund":
      return { ...s, funded: s.funded + a.usdc, log: note(`${a.usdc} USDC transfer verified on-chain`) };
    case "site":
      return { ...s, site: a.ok ? "verified" : "failed", log: note(a.ok ? "Site check passed (HTTP 200)" : "Site check failed (HTTP 503)") };
    case "deadline_passes":
      return { ...s, hours: 7, log: note("Time passes: the announcement deadline is behind us") };
    case "activate_backup":
      return { ...s, ada: "released", grace: "invited", log: note("Founder activated backup Grace and set a new deadline") };
    case "grace_confirms":
      {
      const hours = Math.max(s.hours, 8);
      return { ...s, grace: "confirmed", hours, graceAt: hours, log: note("Grace accepted and confirmed") };
    }
    case "reset":
      return initial;
  }
}

function toInput(s: S): EngineInput {
  const graceLive = s.grace !== "standby";
  const announceDeadline = graceLive ? at(31) : at(6);
  return {
    now: at(s.hours),
    requirements: [
      { id: "announce", title: "Announcement thread goes live", kind: "commitment", mandatory: true, deadlineAt: announceDeadline, dependsOn: [], fundingAmount: null, fundingDecimals: null, fundingSymbol: null },
      { id: "budget", title: "Campaign budget: 5 USDC funded", kind: "funding", mandatory: true, deadlineAt: at(20), dependsOn: [], fundingAmount: "5000000", fundingDecimals: 6, fundingSymbol: "USDC" },
      { id: "site", title: "Landing page is publicly reachable", kind: "url_check", mandatory: true, deadlineAt: null, dependsOn: [], fundingAmount: null, fundingDecimals: null, fundingSymbol: null },
    ],
    assignments: [
      { id: "ada", requirementId: "announce", role: "primary", state: s.ada, label: "Ada", confirmedAt: s.ada === "confirmed" ? at(s.adaAt) : null, declineReason: s.ada === "declined" ? "Family emergency" : null },
      { id: "grace", requirementId: "announce", role: graceLive ? "primary" : "backup", state: s.grace, label: "Grace", confirmedAt: s.grace === "confirmed" ? at(s.graceAt) : null, declineReason: null },
    ],
    evidence:
      s.site === "none"
        ? []
        : [{ id: "e1", requirementId: "site", assignmentId: null, kind: "url", verification: s.site === "verified" ? "verified" : "failed", submittedAt: at(Math.max(s.hours - 0.1, 0)), verifiedAt: at(s.hours), detail: s.site === "failed" ? "HTTP 503" : null }],
    fundingTxs: s.funded > 0 ? [{ id: "t1", requirementId: "budget", status: "verified", amount: String(s.funded * 1_000_000), blockTimestamp: at(2) }] : [],
  };
}

function Btn({ onClick, disabled, children, hint }: { onClick: () => void; disabled?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick} disabled={disabled} className="justify-start text-left" title={disabled ? hint : undefined}>
      {children}
    </Button>
  );
}

export function Simulator() {
  const [s, dispatch] = useReducer(reduce, initial);
  const reduceMotion = useReducedMotion();
  const r = useMemo(() => evaluateReadiness(toInput(s)), [s]);
  const lit = lampFor(r.state, r.counts.blockedOrExpired);
  const expired = r.requirements.find((x) => x.requirementId === "announce")?.status === "expired";
  const adaStuck = s.ada === "accepted" || s.ada === "invited";

  return (
    <div className="@container overflow-hidden rounded-3xl border border-line bg-surface shadow-[var(--shadow)]" role="group" aria-label="Interactive readiness sample">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-sunken px-4 py-2.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Live sample · illustrative data</p>
        <button className="text-[12px] text-ink-2 underline underline-offset-2" onClick={() => dispatch({ t: "reset" })}>Reset</button>
      </div>

      <div className="grid gap-0 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="order-2 border-t border-line p-4 @3xl:order-1 @3xl:border-r @3xl:border-t-0">
          <p className="text-sm font-medium">Make something happen</p>
          <p className="mb-3 text-[13px] text-ink-3">Each button is a real kind of event. Watch the verdict recalculate.</p>
          <div className="grid gap-2 @md:grid-cols-2 @3xl:grid-cols-1">
            <Btn onClick={() => dispatch({ t: "ada_confirms" })} disabled={s.ada !== "invited" && s.ada !== "accepted"} hint="Already answered">Ada confirms the announcement</Btn>
            <Btn onClick={() => dispatch({ t: "fund", usdc: 2 })} disabled={s.funded >= 5}>Send 2 USDC (verified on-chain)</Btn>
            <Btn onClick={() => dispatch({ t: "fund", usdc: 3 })} disabled={s.funded >= 5}>Send 3 USDC (verified on-chain)</Btn>
            <Btn onClick={() => dispatch({ t: "site", ok: true })}>Landing page responds 200</Btn>
            <Btn onClick={() => dispatch({ t: "site", ok: false })}>Landing page returns 503</Btn>
            <Btn onClick={() => dispatch({ t: "ada_steps_down" })} disabled={s.ada === "declined" || s.ada === "released"}>Ada becomes unavailable</Btn>
            <Btn onClick={() => dispatch({ t: "deadline_passes" })} disabled={s.hours >= 7 || !adaStuck}>Let the deadline pass</Btn>
            <Btn onClick={() => dispatch({ t: "activate_backup" })} disabled={s.grace !== "standby" || (s.ada !== "declined" && !expired)}>Founder activates backup Grace</Btn>
            <Btn onClick={() => dispatch({ t: "grace_confirms" })} disabled={s.grace !== "invited"}>Grace confirms</Btn>
          </div>
          {s.log.length > 0 ? (
            <ol className="mt-4 space-y-1 border-t border-line pt-3 text-[13px] text-ink-2" aria-label="Events so far">
              {s.log.map((l, i) => (
                <li key={`${l}-${i}`} className={i === 0 ? "font-medium text-ink" : ""}>{l}</li>
              ))}
            </ol>
          ) : null}
        </div>

        <div className="order-1 p-4 @xl:p-6 @3xl:order-2">
          <div className="flex items-center gap-4">
            <SignalLamps lit={lit} size={14} live={r.state !== "ready"} />
            <div className="min-w-0">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={r.headline}
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  aria-live="polite"
                  className={`font-display text-2xl font-semibold leading-tight sm:text-3xl ${r.state === "ready" ? "text-ready" : r.counts.blockedOrExpired > 0 ? "text-block" : "text-wait"}`}
                >
                  {r.headline}
                </motion.p>
              </AnimatePresence>
              <p className="mt-1 text-[13px] text-ink-2">{r.detail}</p>
            </div>
          </div>

          <ul className="mt-5 space-y-2.5">
            {r.requirements.map((e) => (
              <motion.li layout={!reduceMotion} key={e.requirementId} className="rounded-xl border border-line bg-paper p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{e.title}</p>
                  <StatusPill status={e.status} />
                </div>
                {e.status !== "satisfied" ? (
                  <>
                    <p className="mt-1.5 text-[13px] text-ink-2">{e.reasons[0]?.message}</p>
                    <p className="mt-1 text-[13px]"><span className="text-ink-3">Next:</span> <span className="font-medium">{e.next.label}</span></p>
                  </>
                ) : (
                  <div className="mt-1.5"><TierBadge tier={e.evidenceTier} /></div>
                )}
                {e.progress && e.status !== "satisfied" ? (
                  <p className="tnum mt-1 font-mono text-[12px] text-ink-3">{Number(e.progress.current) / 1e6} / {Number(e.progress.required) / 1e6} USDC verified</p>
                ) : null}
              </motion.li>
            ))}
          </ul>
          {r.blockers.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2" aria-label="Blocker severities">
              {r.blockers.map((b) => (
                <Pill key={b.requirementId} tone={severityTone(b.severity)}>{b.severity === "waiting" ? "Waiting" : b.severity === "expired" ? "Expired" : "Blocked"}: {b.title.split(" ").slice(0, 2).join(" ")}…</Pill>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
