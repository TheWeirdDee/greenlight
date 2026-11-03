import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PortalCard } from "@/components/portal-card";
import { EmptyState } from "@/components/ui";
import { buttonClass } from "@/components/button-class";
import { getCtx } from "@/lib/server/ctx";
import { requireUser } from "@/lib/server/session";
import { listForUser } from "@/lib/services/room";

export const metadata: Metadata = { title: "My commitments" };
export const dynamic = "force-dynamic";

export default async function Portal() {
  const user = await requireUser("/portal");
  const { assignments, launches } = await listForUser(getCtx(), user.id);

  return (
    <AppShell user={user}>
      <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">Contributor portal</p>
      <h1 className="mt-1 font-display text-4xl">Your commitments</h1>
      <p className="mt-2 max-w-xl text-[15px] text-ink-2">Everything you&apos;ve been asked to do across launches. Only you can confirm or step down from these.</p>

      {assignments.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="Nothing assigned to you"
            action={launches.length > 0 ? <Link href="/app" className={buttonClass("secondary")}>Go to your launches</Link> : undefined}
          >
            When a founder invites you, open their private link and your commitment will appear here.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 md:grid-cols-2">
          {assignments.map((a) => (
            <li key={a.assignmentId}><PortalCard a={a} /></li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
