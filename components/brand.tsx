import Link from "next/link";

export function Mark({ size = 22 }: { size?: number }) {
  // Three lamps in a rounded housing; the green one is lit.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="1.5" width="10" height="21" rx="5" fill="var(--ink)" />
      <circle cx="12" cy="6.5" r="2.1" fill="var(--lamp-off)" opacity="0.5" />
      <circle cx="12" cy="12" r="2.1" fill="var(--lamp-off)" opacity="0.5" />
      <circle cx="12" cy="17.5" r="2.4" fill="var(--ready-lamp)" />
    </svg>
  );
}

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 rounded-md" aria-label="Greenlight home">
      <Mark />
      <span className="font-display text-[22px] font-semibold leading-none tracking-tight">greenlight</span>
    </Link>
  );
}
