import { createBrowserClient } from "@supabase/ssr";
import { publicSupabase } from "@/lib/env";

let client: ReturnType<typeof createBrowserClient> | undefined;

export function getSupabaseBrowserClient() {
  if (!client) {
    const { url, key } = publicSupabase();
    client = createBrowserClient(url, key);
  }
  return client;
}
