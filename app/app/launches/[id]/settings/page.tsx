import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { LaunchForm } from "@/components/launch-forms";
import { getCtx } from "@/lib/server/ctx";
import { orNotFound } from "@/lib/server/guard";
import { requireUser } from "@/lib/server/session";
import { getRoom } from "@/lib/services/room";

export const metadata: Metadata = { title: "Edit launch" };
export const dynamic = "force-dynamic";

export default async function LaunchSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/app/launches/${id}/settings`);
  const room = await orNotFound(() => getRoom(getCtx(), user.id, id));
  if (!room.isOwner) notFound();

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-xl">
        <Link href={`/app/launches/${id}`} className="text-sm text-ink-2 underline underline-offset-4">← Back to launch room</Link>
        <h1 className="mt-3 font-display text-4xl">Edit launch</h1>
        <p className="mb-8 mt-2 text-[15px] text-ink-2">Changing the target date moves the countdown; it doesn&apos;t change any requirement or its deadline.</p>
        <LaunchForm mode="edit" launch={{ id, name: room.launch.name, tagline: room.launch.tagline, targetAt: room.launch.targetAt }} />
      </div>
    </AppShell>
  );
}
