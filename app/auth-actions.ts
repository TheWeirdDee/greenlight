"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/env";
import { safeNext } from "@/lib/safe-next";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const credentials = z.object({
  email: z.string().trim().email("Enter a valid email address").max(254),
  password: z.string().min(8, "Use at least 8 characters").max(128),
  name: z.string().trim().max(80).optional(),
});

/** `email` and `name` echo what was typed: React resets the form after every action, so without them a failed attempt would wipe the user's input. */
export type AuthState = { error: string | null; notice?: string | null; email?: string; name?: string };

const typed = (form: FormData) => ({ email: String(form.get("email") ?? ""), name: String(form.get("name") ?? "") });

export async function signInAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: "Authentication is not configured on this deployment.", ...typed(form) };
  const parsed = credentials.pick({ email: true, password: true }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, ...typed(form) };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // One message for unknown email and wrong password: do not reveal which accounts exist.
  if (error) return { error: "That email and password don't match.", ...typed(form) };
  redirect(safeNext(form.get("next") as string | null));
}

export async function signUpAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: "Authentication is not configured on this deployment.", ...typed(form) };
  const parsed = credentials.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, ...typed(form) };
  const supabase = await createSupabaseServerClient();
  const next = safeNext(form.get("next") as string | null);
  // Where the confirmation email should send the user back to (must be an allowed Redirect URL in Supabase).
  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.name || parsed.data.email.split("@")[0] },
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) return { error: error.message, ...typed(form) };
  // Accounts are shared across every app on this Supabase project. Supabase answers a sign-up for an
  // address that already exists with a user that has no identities (and, to avoid leaking which emails are
  // registered, no error): point the person at sign-in instead of waiting for an email that won't come.
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return { error: "An account with this email already exists. Accounts are shared across apps on this service, so sign in with your existing password.", ...typed(form) };
  }
  // With email confirmation enabled Supabase returns no session until the link is clicked.
  if (!data.session) {
    return { error: null, notice: "Check your inbox and click the confirmation link — it brings you straight back here.", ...typed(form) };
  }
  redirect(next);
}

export async function signOutAction() {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/");
}
