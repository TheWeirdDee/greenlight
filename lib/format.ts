import { formatUnits } from "@/lib/units";

/**
 * All timestamps are rendered in UTC with an explicit label. That is deterministic between server
 * and client (no hydration mismatch) and unambiguous for distributed launch teams.
 */
const dtf = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export const fmtDateTime = (iso: string | null | undefined) => (iso ? `${dtf.format(new Date(iso))} UTC` : "—");

const relUnits: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function fmtRelative(iso: string, nowMs: number) {
  const diff = new Date(iso).getTime() - nowMs;
  for (const [unit, ms] of relUnits) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

export const fmtAmount = (units: string, decimals: number, symbol: string) => {
  const [whole, frac = ""] = formatUnits(units, decimals).split(".");
  return `${BigInt(whole).toLocaleString("en-US")}${frac ? `.${frac}` : ""} ${symbol}`.trim();
};

export const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** `datetime-local` value (browser-local) → ISO string. */
export const localToIso = (v: string) => (v ? new Date(v).toISOString() : "");
/** ISO string → `datetime-local` value in the browser's zone. */
export const isoToLocal = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
