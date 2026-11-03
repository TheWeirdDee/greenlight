import "server-only";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import type { Ctx } from "@/lib/services/context";
import { getCtx } from "./ctx";
import { getSessionUser, type SessionUser } from "./session";

export type ActionResult<T = undefined> = { ok: true; data: T; duplicate?: boolean } | { ok: false; error: string };

/**
 * Wraps a server action: authenticates the caller, runs the service call, and converts expected
 * failures into user-presentable messages. Unexpected errors are logged without their details
 * leaking to the client.
 */
export async function run<T>(fn: (user: SessionUser, ctx: Ctx) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const user = await getSessionUser();
    if (!user) return { ok: false, error: "Your session has expired. Please sign in again." };
    return { ok: true, data: await fn(user, getCtx()) };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    console.error("[action] unexpected error:", e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/** Unwraps the duplicate-aware envelope returned by launch-scoped mutations. */
export function unwrap<T>(r: { duplicate: true } | { duplicate: false; value: T }): { value?: T; duplicate: boolean } {
  return r.duplicate ? { duplicate: true } : { duplicate: false, value: r.value };
}
