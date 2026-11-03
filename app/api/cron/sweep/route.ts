import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getCtx } from "@/lib/server/ctx";
import { sweepAll } from "@/lib/services/room";

export const dynamic = "force-dynamic";

/**
 * Scheduled sweep (Vercel Cron). Records deadlines that have passed and promotes funding
 * transactions that have reached their confirmation depth, even when nobody has the room open.
 * Protected by CRON_SECRET, which Vercel sends as a Bearer token.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  const ok =
    Boolean(secret) && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await sweepAll(getCtx());
  return NextResponse.json(result);
}
