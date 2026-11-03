import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicSupabase } from "@/lib/env";

/** Per-request Supabase client bound to the caller's cookies. Never reuse across requests. */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, key } = publicSupabase();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, which cannot set cookies. proxy.ts refreshes the session.
        }
      },
    },
  });
}
