"use client";

import { useEffect, useState } from "react";

function parts(ms: number) {
  const abs = Math.abs(ms);
  return {
    d: Math.floor(abs / 86_400_000),
    h: Math.floor((abs % 86_400_000) / 3_600_000),
    m: Math.floor((abs % 3_600_000) / 60_000),
    s: Math.floor((abs % 60_000) / 1000),
  };
}

/** Live countdown to the launch target. Starts from the server's clock so it never flashes a wrong value. */
export function Countdown({ targetIso, serverNowIso, label = "Launch" }: { targetIso: string; serverNowIso: string; label?: string }) {
  const [offset] = useState(() => new Date(serverNowIso).getTime() - Date.now());
  const [now, setNow] = useState(() => new Date(serverNowIso).getTime());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(id);
  }, [offset]);

  const diff = new Date(targetIso).getTime() - now;
  const p = parts(diff);
  const overdue = diff < 0;
  const cells: Array<[string, number]> = [["d", p.d], ["h", p.h], ["m", p.m], ["s", p.s]];

  return (
    <div role="timer" aria-label={`${label} ${overdue ? "passed" : "in"} ${p.d} days ${p.h} hours ${p.m} minutes`} className="inline-flex flex-col gap-1">
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">{overdue ? `${label} window passed` : `T-minus to ${label.toLowerCase()}`}</span>
      <span className={`tnum flex items-baseline gap-2 font-mono ${overdue ? "text-block" : "text-ink"}`}>
        {overdue ? <span className="text-sm">+</span> : null}
        {cells.map(([unit, v]) => (
          <span key={unit} className="inline-flex items-baseline">
            <span className="text-2xl font-semibold sm:text-3xl">{String(v).padStart(2, "0")}</span>
            <span className="ml-0.5 text-xs text-ink-3">{unit}</span>
          </span>
        ))}
      </span>
    </div>
  );
}
