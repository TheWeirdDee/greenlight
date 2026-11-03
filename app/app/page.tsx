import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { CreateWorkspaceForm } from "@/components/launch-forms";
import { lampFor, Pill, SignalLamps } from "@/components/status";
import { Card, EmptyState } from "@/components/ui";
import { buttonClass } from "@/components/button-class";
import { fmtDateTime } from "@/lib/format";
import { getCtx } from "@/lib/server/ctx";
import { requireUser } from "@/lib/server/session";
import { listForUser } from "@/lib/services/room";

export const metadata: Metadata = { title: "Launches" };
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const user = await requireUser("/app");
  const { launches, workspaces, assignments } = await listForUser(getCtx(), user.id);

  return (
    <AppShell user={user}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">Your launches</p>
          <h1 className="mt-1 font-display text-4xl">Are you ready?</h1>
        </div>
        {workspaces.length > 0 ? <Link href="/app/launches/new" className={buttonClass("primary")}>New launch</Link> : null}
      </div>

      {workspaces.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="Create your workspace">
            A workspace holds your launches and the people confirming them. You&apos;ll be its founder.
            <CreateWorkspaceForm />
          </EmptyState>
        </div>
      ) : launches.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="No launch rooms yet" action={<Link href="/app/launches/new" className={buttonClass("primary")}>Create your first launch</Link>}>
            Set a target date, define what must be true to launch, and invite the people who own each piece.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {launches.map((l) => {
            const ready = l.state === "ready";
            const hard = !ready && /BLOCKER/.test(l.headline) ? 1 : 0;
            return (
              <li key={l.id}>
                <Link href={`/app/launches/${l.id}`} className="block rounded-2xl focus-visible:outline-offset-4">
                  <Card as="div" className="flex items-start gap-4 p-5 transition-colors hover:border-line-strong">
                    <SignalLamps lit={lampFor(l.state, hard)} size={12} />
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] uppercase tracking-wider text-ink-3">{l.workspaceName}</p>
                      <h2 className="mt-0.5 truncate font-display text-2xl">{l.name}</h2>
                      <p className={`mt-1 text-sm font-semibold ${ready ? "text-ready" : "text-block"}`}>{l.headline}</p>
                      <p className="mt-1 text-[13px] text-ink-3">Target {fmtDateTime(l.targetAt)}</p>
                      {l.decision ? <div className="mt-2"><Pill tone={l.decision === "hold" ? "wait" : "ready"}>{l.decision === "hold" ? "On hold" : "Decision: proceed"}</Pill></div> : null}
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {assignments.length > 0 ? (
        <p className="mt-8 text-sm text-ink-2">
          You also have {assignments.length} commitment{assignments.length === 1 ? "" : "s"} on other launches.{" "}
          <Link href="/portal" className="font-medium text-ink underline underline-offset-4">Open your portal</Link>
        </p>
      ) : null}
    </AppShell>
  );
}
