import Link from "next/link";
import { signOutAction } from "@/app/auth-actions";
import type { SessionUser } from "@/lib/server/session";
import { Wordmark } from "./brand";
import { ThemeToggle } from "./theme-toggle";

export function AppShell({ user, children, wide = false }: { user: SessionUser; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-5">
            <Wordmark href="/app" />
            <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
              <Link href="/app" className="rounded-md px-2.5 py-1.5 text-sm text-ink-2 hover:bg-sunken hover:text-ink">
                Launches
              </Link>
              <Link href="/portal" className="rounded-md px-2.5 py-1.5 text-sm text-ink-2 hover:bg-sunken hover:text-ink">
                My commitments
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <details className="relative">
              <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-line-strong bg-surface px-2.5 text-sm [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-paper">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden max-w-[10rem] truncate sm:inline">{user.name}</span>
                <span className="sr-only">Account menu</span>
              </summary>
              <div className="absolute right-0 mt-2 w-60 rounded-xl border border-line bg-surface p-2 shadow-[var(--shadow)]">
                <p className="truncate px-2 py-1.5 text-[13px] text-ink-3">{user.email ?? user.name}</p>
                <Link href="/app" className="block rounded-md px-2 py-2 text-sm hover:bg-sunken sm:hidden">
                  Launches
                </Link>
                <Link href="/portal" className="block rounded-md px-2 py-2 text-sm hover:bg-sunken sm:hidden">
                  My commitments
                </Link>
                <form action={signOutAction}>
                  <button className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-sunken">Sign out</button>
                </form>
              </div>
            </details>
          </div>
        </div>
      </header>
      <main id="main" className={`mx-auto px-4 py-6 sm:px-6 sm:py-10 ${wide ? "max-w-7xl" : "max-w-6xl"}`}>
        {children}
      </main>
    </div>
  );
}
