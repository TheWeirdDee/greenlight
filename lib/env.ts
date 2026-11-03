import { z } from "zod";

/**
 * Environment access. Public values are inlined into the client bundle by Next.js; everything else
 * stays on the server. Server values are validated lazily so `next build` and the landing page work
 * before secrets are configured, while any attempt to use the database fails loudly and clearly.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (Supabase → Project Settings → Database → Connection string)"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  BASE_SEPOLIA_RPC_URL: z.string().url().optional(),
  CRON_SECRET: z.string().min(16).optional(),
});

export function serverEnv() {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Greenlight is not configured. ${missing}. See README → Environment variables.`);
  }
  return parsed.data;
}

export const publicSupabase = () => ({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
});

export const isSupabaseConfigured = () => Boolean(publicSupabase().url && publicSupabase().key && process.env.DATABASE_URL);
