import type { BlockerSeverity, EvidenceTier, RequirementStatus } from "@/lib/readiness/types";

type Tone = "ready" | "wait" | "block" | "expired" | "neutral";

const toneClass: Record<Tone, string> = {
  ready: "bg-ready-bg text-ready",
  wait: "bg-wait-bg text-wait",
  block: "bg-block-bg text-block",
  expired: "bg-expired-bg text-expired",
  neutral: "bg-sunken text-ink-2",
};

function Glyph({ tone }: { tone: Tone }) {
  const common = { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (tone) {
    case "ready":
      return (
        <svg {...common}>
          <path d="M3 8.5 6.5 12 13 4.5" />
        </svg>
      );
    case "block":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M4.2 11.8 11.8 4.2" />
        </svg>
      );
    case "expired":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 4.8V8l2.2 1.4" />
        </svg>
      );
    case "wait":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M5.4 8h.01M8 8h.01M10.6 8h.01" strokeWidth="2.4" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2" />
        </svg>
      );
  }
}

export function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold tracking-wide ${toneClass[tone]}`}>
      <Glyph tone={tone} />
      {children}
    </span>
  );
}

const statusMap: Record<RequirementStatus, { tone: Tone; label: string }> = {
  satisfied: { tone: "ready", label: "Satisfied" },
  incomplete: { tone: "wait", label: "Incomplete" },
  blocked: { tone: "block", label: "Blocked" },
  expired: { tone: "expired", label: "Expired" },
};
export const StatusPill = ({ status }: { status: RequirementStatus }) => <Pill tone={statusMap[status].tone}>{statusMap[status].label}</Pill>;

export const severityTone = (s: BlockerSeverity): Tone => (s === "expired" ? "expired" : s === "blocked" ? "block" : "wait");

export function TierBadge({ tier }: { tier: EvidenceTier }) {
  if (tier === "none") return null;
  return tier === "verified" ? (
    <span className="inline-flex items-center gap-1 rounded-md border border-ready/40 px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wider text-ready" title="Established by Greenlight itself: an onchain check or a server-side fetch.">
      <Glyph tone="ready" /> Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md border border-line-strong px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wider text-ink-2" title="Recorded with its author and time, but not independently checked.">
      Submitted claim
    </span>
  );
}

/** Three-lamp signal. Exactly one lamp is lit; the text beside it carries the same meaning. */
export function SignalLamps({ lit, size = 16, live = false }: { lit: "red" | "amber" | "green"; size?: number; live?: boolean }) {
  const lamp = (name: "red" | "amber" | "green", color: string) => (
    <span
      key={name}
      className={`block rounded-full transition-colors duration-500 ${lit === name && live ? "lamp-live" : ""}`}
      style={{
        width: size,
        height: size,
        background: lit === name ? color : "var(--lamp-off)",
        color,
        boxShadow: lit === name ? `0 0 ${size}px color-mix(in srgb, ${color} 55%, transparent)` : "none",
      }}
    />
  );
  return (
    <span className="inline-flex flex-col gap-1.5 rounded-full border border-line-strong bg-sunken p-1.5" aria-hidden="true">
      {lamp("red", "var(--block-lamp)")}
      {lamp("amber", "var(--wait-lamp)")}
      {lamp("green", "var(--ready-lamp)")}
    </span>
  );
}

export function lampFor(state: "ready" | "not_ready", blockedOrExpired: number): "red" | "amber" | "green" {
  if (state === "ready") return "green";
  return blockedOrExpired > 0 ? "red" : "amber";
}
