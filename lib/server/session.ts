import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/services/launches";
import type { Actor } from "@/lib/services/context";
import { getCtx } from "./ctx";

export interface SessionUser extends Actor {
  email: string | null;
}

/**
 * The authenticated caller, derived from a signature-verified JWT (getClaims), never from request
 * input. Memoised per request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;

  const email = (claims.email as string | undefined) ?? null;
  const meta = (claims.user_metadata ?? {}) as { full_name?: string; name?: string };
  const name = meta.full_name || meta.name || (email ? email.split("@")[0] : "Member");
  await ensureProfile(getCtx().db, { id: claims.sub, email, name });
  return { id: claims.sub, email, name };
});

export async function requireUser(next?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}
