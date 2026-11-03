"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Keeps the room current without a manual reload:
 *  - Supabase Realtime pushes a notification whenever a new event lands for this launch;
 *  - a timer re-renders at the next deadline so expiry appears the moment it happens;
 *  - a slow poll covers a dropped websocket and pending on-chain confirmations.
 * The notifications carry no data of their own: the page always re-reads authoritative state.
 */
export function LiveRefresh({ launchId, deadlines, pollMs = 20_000 }: { launchId: string; deadlines: string[]; pollMs?: number }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const last = useRef(0);

  useEffect(() => {
    const refresh = () => {
      const now = Date.now();
      if (now - last.current < 800) return; // coalesce bursts of events
      last.current = now;
      router.refresh();
    };

    let channel: ReturnType<ReturnType<typeof getSupabaseBrowserClient>["channel"]> | undefined;
    const supabase = getSupabaseBrowserClient();
    try {
      channel = supabase
        .channel(`launch:${launchId}`)
        .on("postgres_changes", { event: "INSERT", schema: "greenlight", table: "events", filter: `launch_id=eq.${launchId}` }, refresh)
        .subscribe((status: string) => setConnected(status === "SUBSCRIBED"));
    } catch {
      /* realtime unavailable: polling still keeps the room current */
    }

    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, pollMs);

    const timers = deadlines
      .map((d) => new Date(d).getTime() - Date.now())
      .filter((ms) => ms > 0 && ms < 2 ** 31 - 1)
      .map((ms) => setTimeout(refresh, ms + 1500));

    return () => {
      clearInterval(poll);
      timers.forEach(clearTimeout);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [launchId, deadlines, pollMs, router]);

  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-3" title={connected ? "Realtime connected" : "Updating every 20 seconds"}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-[var(--ready-lamp)]" : "bg-[var(--lamp-off)]"}`} />
      {connected ? "Live" : "Auto-refresh"}
    </span>
  );
}
