import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { Wordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { isSupabaseConfigured } from "@/lib/env";
import { getSessionUser } from "@/lib/server/session";
import { safeNext } from "@/lib/safe-next";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; mode?: string; error?: string }> }) {
  const { next, mode, error } = await searchParams;
  const user = await getSessionUser();
  if (user) redirect(safeNext(next));

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Wordmark />
          <ThemeToggle />
        </div>
        <main id="main" className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          {error === "confirmation" ? (
            <p role="alert" className="mb-6 rounded-lg border border-block/30 bg-block-bg px-3 py-2 text-sm text-block">
              That confirmation link is invalid or has expired. Sign in if you already confirmed, or create the account again to get a new link.
            </p>
          ) : null}
          {!isSupabaseConfigured() ? (
            <p role="alert" className="mb-6 rounded-lg border border-wait/40 bg-wait-bg px-3 py-2 text-sm text-wait">
              This deployment has no Supabase project configured yet, so sign-in is unavailable.
            </p>
          ) : null}
          <AuthForm next={safeNext(next)} initialMode={mode === "signup" ? "signup" : "signin"} invite={Boolean(next?.startsWith("/invite/"))} />
        </main>
      </div>
      <aside className="hidden flex-col justify-between border-l border-line bg-sunken p-12 lg:flex" aria-hidden="true">
        <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">The rule</p>
        <blockquote className="font-display text-5xl leading-[1.05] text-ink">
          A launch is ready when the evidence says so —
          <span className="text-ink-3"> not when someone says it is.</span>
        </blockquote>
        <p className="max-w-sm text-sm text-ink-2">
          Every confirmation here carries an authenticated name and a real timestamp. Funding is checked on Base Sepolia, not taken on trust.
        </p>
      </aside>
    </div>
  );
}
