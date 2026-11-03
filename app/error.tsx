"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[ui] render error", error.digest ?? "");
  }, [error]);

  const unconfigured = /not configured/i.test(error.message);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-4xl">{unconfigured ? "Greenlight isn’t configured yet" : "Something went wrong"}</h1>
      <p className="mt-3 max-w-md text-ink-2">
        {unconfigured
          ? "The database or authentication settings are missing on this deployment. See the README for the environment variables."
          : "The page couldn’t be loaded. Your data is safe — try again."}
      </p>
      <Button className="mt-8" onClick={reset}>Try again</Button>
    </div>
  );
}
