"use server";

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

export type AuthState = { error: string | null; notice?: string | null };

export async function signInAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: "Authentication is not configured on this deployment." };
  const parsed = credentials.pick({ email: true, password: true }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // One message for unknown email and wrong password: do not reveal which accounts exist.
  if (error) return { error: "That email and password don't match." };
  redirect(safeNext(form.get("next") as string | null));
}

export async function signUpAction(_prev: AuthState, form: FormData): Promise<AuthState> {
  if (!isSupabaseConfigured()) return { error: "Authentication is not configured on this deployment." };
  const parsed = credentials.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.name || parsed.data.email.split("@")[0] } },
  });
  if (error) return { error: error.message };
  // With email confirmation enabled Supabase returns no session until the link is clicked.
  if (!data.session) {
    return { error: null, notice: "Check your inbox to confirm your email, then sign in." };
  }
  redirect(safeNext(form.get("next") as string | null));
}

export async function signOutAction() {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/");
}
