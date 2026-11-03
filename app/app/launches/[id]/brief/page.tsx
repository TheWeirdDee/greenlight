import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BriefActions } from "@/components/brief-actions";
import { BriefDocument } from "@/components/brief-document";
import { getCtx } from "@/lib/server/ctx";
import { orNotFound } from "@/lib/server/guard";
import { requireUser } from "@/lib/server/session";
import { getOwnerBrief } from "@/lib/services/brief";
import { getRoom } from "@/lib/services/room";

export const metadata: Metadata = { title: "Readiness brief" };
export const dynamic = "force-dynamic";

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/app/launches/${id}/brief`);
  const ctx = getCtx();
  const [brief, room] = await orNotFound(() => Promise.all([getOwnerBrief(ctx, user, id), getRoom(ctx, user.id, id)]));

  return (
    <AppShell user={user}>
      <Link href={`/app/launches/${id}`} className="mb-6 inline-block text-sm text-ink-2 underline underline-offset-4 print:hidden">← Back to launch room</Link>
      <BriefActions launchId={id} shareToken={room.launch.shareToken} />
      <BriefDocument brief={brief} />
    </AppShell>
  );
}
