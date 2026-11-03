import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { safeNext } from "@/lib/safe-next";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Completes email confirmation. Supabase sends the user here from the confirmation email, either with a
 * PKCE `code` (default) or a `token_hash` + `type` (custom templates). On success the session cookie is
 * set and the user continues to `next` (restricted to same-site paths, so it cannot be an open redirect).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const fail = () => NextResponse.redirect(new URL(`/login?error=confirmation&next=${encodeURIComponent(next)}`, origin));
  if (!isSupabaseConfigured()) return fail();

  const supabase = await createSupabaseServerClient();
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  let error: unknown = new Error("missing credentials");
  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type) {
    ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));
  }
  if (error) return fail();
  return NextResponse.redirect(new URL(next, origin));
}
