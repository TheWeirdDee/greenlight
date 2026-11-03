"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/server/action";

/**
 * Runs a server action with pending/error state and refreshes server data on success.
 *
 * `key()` returns a stable idempotency key for the current intent. It is reused across retries and
 * double-clicks (so the server processes the intent once) and rotated after a successful run.
 */
export function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  const key = useCallback(() => {
    if (!keyRef.current) keyRef.current = crypto.randomUUID();
    return keyRef.current;
  }, []);

  const act = useCallback(
    <T,>(fn: (key: string) => Promise<ActionResult<T>>, onOk?: (data: T) => void) => {
      setError(null);
      const k = key();
      start(async () => {
        try {
          const r = await fn(k);
          if (!r.ok) {
            setError(r.error);
            return;
          }
          keyRef.current = null;
          onOk?.(r.data);
          router.refresh();
        } catch {
          setError("Network error. Please try again.");
        }
      });
    },
    [key, router],
  );

  return { act, pending, error, setError };
}
