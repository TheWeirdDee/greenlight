"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { buttonClass } from "../button-class";
import { ThemeToggle } from "../theme-toggle";

const links = [
  ["#sample", "Live sample"],
  ["#difference", "Why not a checklist"],
  ["#how", "How it works"],
  ["#evidence", "Evidence"],
  ["#limits", "Limits"],
] as const;

/** Phone navigation: the desktop nav is hidden below `md`, so everything it offers lives here. */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-line-strong bg-surface"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M4 4l10 10M14 4 4 14" /> : <path d="M3 5h12M3 9h12M3 13h12" />}
        </svg>
      </button>
      {open ? (
        <div id={id} className="absolute inset-x-0 top-14 z-40 border-b border-line bg-paper px-4 pb-5 pt-2 shadow-[var(--shadow)]">
          <nav aria-label="Mobile">
            <ul className="divide-y divide-line">
              {links.map(([href, label]) => (
                <li key={href}>
                  <a href={href} onClick={() => setOpen(false)} className="block py-3 text-[17px]">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link href="/login?mode=signup" className={buttonClass("primary")} onClick={() => setOpen(false)}>
              Open a launch room
            </Link>
            <Link href="/login" className={buttonClass("secondary")} onClick={() => setOpen(false)}>
              Sign in
            </Link>
          </div>
          <div className="mt-4 flex items-center gap-3 text-sm text-ink-2">
            Theme <ThemeToggle />
          </div>
        </div>
      ) : null}
    </div>
  );
}
