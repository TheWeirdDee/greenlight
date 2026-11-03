import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { LaunchForm } from "@/components/launch-forms";
import { getCtx } from "@/lib/server/ctx";
import { requireUser } from "@/lib/server/session";
import { listForUser } from "@/lib/services/room";

export const metadata: Metadata = { title: "New launch" };
export const dynamic = "force-dynamic";

export default async function NewLaunch() {
  const user = await requireUser("/app/launches/new");
  const { workspaces } = await listForUser(getCtx(), user.id);
  if (workspaces.length === 0) redirect("/app");

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-xl">
        <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">New launch room</p>
        <h1 className="mt-1 font-display text-4xl">What are you launching?</h1>
        <p className="mb-8 mt-2 text-[15px] text-ink-2">You&apos;ll define the requirements next. Readiness starts at NOT READY and only changes when real evidence arrives.</p>
        <LaunchForm mode="create" workspaces={workspaces} />
      </div>
    </AppShell>
  );
}
