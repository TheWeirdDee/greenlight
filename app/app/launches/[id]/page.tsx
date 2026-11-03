import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { RoomView } from "@/components/room/room-view";
import { getCtx } from "@/lib/server/ctx";
import { orNotFound } from "@/lib/server/guard";
import { requireUser } from "@/lib/server/session";
import { getRoom } from "@/lib/services/room";

export const metadata: Metadata = { title: "Launch room" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LaunchRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/app/launches/${id}`);
  if (!UUID.test(id)) notFound();
  const room = await orNotFound(() => getRoom(getCtx(), user.id, id));

  return (
    <AppShell user={user} wide>
      <RoomView room={room} />
    </AppShell>
  );
}
