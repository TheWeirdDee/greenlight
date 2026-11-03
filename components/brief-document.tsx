import { addressUrl } from "@/lib/chain/config";
import { safeHref } from "@/lib/safe-url";
import { fmtAmount, fmtDateTime, shortAddr, shortHash } from "@/lib/format";
import type { Brief } from "@/lib/services/brief";
import { Pill, TierBadge } from "./status";

const statusTone = { satisfied: "ready", incomplete: "wait", blocked: "block", expired: "expired" } as const;
const statusLabel = { satisfied: "Satisfied", incomplete: "Incomplete", blocked: "Blocked", expired: "Expired" } as const;
const kindLabel: Record<string, string> = { commitment: "Commitment", deliverable: "Deliverable", url_check: "Site check", funding: "Funding" };

/**
 * The Launch Readiness Brief. A record of what was recorded and verified at a moment in time —
 * not a guarantee that contributors will deliver or that the launch will succeed.
 */
export function BriefDocument({ brief, heading }: { brief: Brief; heading?: string }) {
  const ready = brief.readiness.state === "ready";
  const d = brief.decision;
  return (
    <article className="mx-auto max-w-3xl space-y-10 print:space-y-6">
      <header className="border-b-2 border-ink pb-6">
        <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">{heading ?? "Launch Readiness Brief"} · {brief.launch.workspaceName}</p>
        <h1 className="mt-2 break-words font-display text-4xl leading-tight sm:text-5xl">{brief.launch.name}</h1>
        {brief.launch.tagline ? <p className="mt-2 text-lg text-ink-2">{brief.launch.tagline}</p> : null}
        <dl className="mt-5 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-ink-3">Target launch</dt><dd className="font-medium">{fmtDateTime(brief.launch.targetAt)}</dd></div>
          <div><dt className="text-ink-3">Generated</dt><dd className="font-medium">{fmtDateTime(brief.generatedAt)}</dd></div>
        </dl>
      </header>

      <section aria-labelledby="b-status">
        <h2 id="b-status" className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">Readiness</h2>
        <p className={`mt-2 font-display text-4xl font-semibold sm:text-5xl ${ready ? "text-ready" : "text-block"}`}>{brief.readiness.headline}</p>
        <p className="mt-2 text-ink-2">{brief.readiness.detail}</p>
      </section>

      <section aria-labelledby="b-decision">
        <h2 id="b-decision" className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">Founder decision</h2>
        {d ? (
          <div className="mt-2 rounded-xl border border-line-strong p-4">
            <p className="text-lg font-medium">
              {d.decision === "hold" ? "Hold — not cleared to launch" : d.decision === "proceed" ? "Proceed — cleared to launch" : "Proceed despite open blockers (override)"}
            </p>
            <p className="mt-1 text-sm text-ink-2">{d.decidedBy} · {fmtDateTime(d.decidedAt)}</p>
            {d.note ? <p className="mt-2 text-[15px]">“{d.note}”</p> : null}
            {d.unresolvedAtDecision.length > 0 ? (
              <div className="mt-3 text-sm">
                <p className="font-medium text-block">Unresolved when the decision was made:</p>
                <ul className="mt-1 list-disc pl-5 text-ink-2">{d.unresolvedAtDecision.map((u) => <li key={u}>{u}</li>)}</ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-ink-2">No decision recorded yet. The founder retains final authority over whether to launch.</p>
        )}
      </section>

      {brief.blockers.length > 0 ? (
        <section aria-labelledby="b-blockers">
          <h2 id="b-blockers" className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">Outstanding blockers ({brief.blockers.length})</h2>
          <ul className="mt-3 space-y-3">
            {brief.blockers.map((b) => (
              <li key={b.title} className="rounded-xl border border-line p-4">
                <p className="font-medium">{b.title}</p>
                <p className="mt-1 text-[15px] text-ink-2">{b.summary}</p>
                <p className="mt-2 text-sm text-ink-3">Responsible: {b.owner ?? "unassigned"} · Next: {b.next}{b.deadlineAt ? ` · Deadline ${fmtDateTime(b.deadlineAt)}` : ""}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="b-reqs">
        <h2 id="b-reqs" className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">Requirements &amp; evidence</h2>
        <p className="mt-2 text-sm text-ink-2">
          <strong>Verified</strong> means Greenlight checked it itself (an on-chain transfer or a server-side fetch). <strong>Submitted claim</strong> means a named, authenticated person said so at the recorded time; Greenlight has not independently checked it.
        </p>
        <ul className="mt-4 space-y-4">
          {brief.requirements.map((r) => (
            <li key={r.title} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={statusTone[r.status as keyof typeof statusTone]}>{statusLabel[r.status as keyof typeof statusLabel]}</Pill>
                <span className="font-medium">{r.title}</span>
                <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">{kindLabel[r.kind]}{r.mandatory ? "" : " · optional"}</span>
                <TierBadge tier={r.evidenceTier} />
              </div>
              <p className="mt-2 text-sm text-ink-3">
                Responsible: {r.owner ?? "—"}{r.deadlineAt ? ` · Deadline ${fmtDateTime(r.deadlineAt)}` : ""}{r.satisfiedAt ? ` · Satisfied ${fmtDateTime(r.satisfiedAt)}` : ""}
              </p>
              {r.status !== "satisfied" && r.reasons.length > 0 ? <p className="mt-1 text-sm text-ink-2">{r.reasons.join("; ")}</p> : null}
              {r.evidence.length > 0 ? (
                <ul className="mt-3 divide-y divide-line rounded-lg border border-line text-sm">
                  {r.evidence.map((e, i) => (
                    <li key={i} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
                      <span className="min-w-0 break-all">{e.value === null ? <em className="text-ink-3">Note (withheld from public view)</em> : e.kind === "url" && safeHref(e.value) ? <a className="underline underline-offset-2" href={safeHref(e.value)} rel="noreferrer noopener" target="_blank">{e.value}</a> : e.value}</span>
                      <span className="flex min-w-0 flex-wrap items-center gap-2 text-[12px] text-ink-3">
                        {e.submittedBy} · {fmtDateTime(e.submittedAt)}
                        <Pill tone={e.knownAs === "verified" ? "ready" : e.knownAs === "failed" ? "block" : "neutral"}>
                          {e.knownAs === "verified" ? `Verified${e.summary ? `: ${e.summary}` : ""}` : e.knownAs === "failed" ? `Check failed${e.summary ? `: ${e.summary}` : ""}` : "Submitted claim"}
                        </Pill>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {brief.funding.length > 0 ? (
        <section aria-labelledby="b-funding">
          <h2 id="b-funding" className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">Funding · Base Sepolia (testnet)</h2>
          {brief.funding.map((f) => (
            <div key={f.requirement} className="mt-3 rounded-xl border border-line p-4">
              <p className="font-medium">{f.requirement}</p>
              <p className="tnum mt-1 font-mono text-sm">{fmtAmount(f.verified, 6, f.symbol)} verified of {fmtAmount(f.target, 6, f.symbol)} · recipient <a className="underline underline-offset-2" href={addressUrl(f.recipient)} target="_blank" rel="noreferrer">{shortAddr(f.recipient)}</a></p>
              {f.transactions.length === 0 ? (
                <p className="mt-2 text-sm text-ink-3">No funding transactions recorded.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line rounded-lg border border-line text-sm">
                  {f.transactions.map((t) => (
                    <li key={t.txHash} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
                      <a className="font-mono underline underline-offset-2" href={t.explorerUrl} target="_blank" rel="noreferrer">{shortHash(t.txHash)}</a>
                      <span className="tnum font-mono">{t.amount ? fmtAmount(t.amount, 6, f.symbol) : "—"}</span>
                      <span className="text-[12px] text-ink-3">{t.blockTimestamp ? `Block ${t.blockNumber} · ${fmtDateTime(t.blockTimestamp)}` : "pending"}</span>
                      <Pill tone={t.status === "verified" ? "ready" : "wait"}>{t.status === "verified" ? "Verified on-chain" : "Awaiting confirmations"}</Pill>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      ) : null}

      <section aria-labelledby="b-people">
        <h2 id="b-people" className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">Contributor responsibilities</h2>
        {brief.contributors.length === 0 ? (
          <p className="mt-2 text-ink-2">No contributors assigned.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-ink-3"><tr><th className="py-1.5 pr-3 font-normal">Contributor</th><th className="py-1.5 pr-3 font-normal">Responsible for</th><th className="py-1.5 font-normal">Status</th></tr></thead>
            <tbody className="divide-y divide-line">
              {brief.contributors.map((c, i) => (
                <tr key={i}>
                  <td className="py-2 pr-3 font-medium">{c.name}</td>
                  <td className="py-2 pr-3">{c.requirement}</td>
                  <td className="py-2">{c.state === "confirmed" && c.confirmedAt ? `Confirmed ${fmtDateTime(c.confirmedAt)}` : c.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="border-t border-line pt-5 text-[13px] leading-relaxed text-ink-3">
        This brief is an operational record of conditions recorded and verified at the time shown. A confirmation proves an authenticated account confirmed — not that the work will be done. Readiness is not investment safety, legal approval, or a prediction of market performance. Funding shown is Base Sepolia test funds.
      </footer>
    </article>
  );
}
