import { AppError } from "@/lib/errors";

/**
 * Best-effort sliding-window limiter for actions that make outbound network calls on a user's behalf
 * (site checks, on-chain verification). It is per server instance — a guard against accidental floods and
 * casual abuse, not a distributed quota; the provider's own limits remain the backstop.
 */
const hits = new Map<string, number[]>();

export function assertWithinRate(key: string, max: number, windowMs: number, now: Date) {
  const t = now.getTime();
  const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
  if (recent.length >= max) {
    throw new AppError("invalid", "Too many attempts in a short time. Please wait a minute and try again.");
  }
  recent.push(t);
  hits.set(key, recent);
  // keep the map from growing without bound
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((x) => t - x >= windowMs)) hits.delete(k);
}

/** Test helper. */
export const resetRateLimits = () => hits.clear();
