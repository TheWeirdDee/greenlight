"use client";

import { useState } from "react";
import { createShareAction, revokeShareAction } from "@/app/actions";
import { Button, Card, ErrorNote } from "./ui";
import { useAct } from "./use-act";

export function BriefActions({ launchId, shareToken }: { launchId: string; shareToken: string | null }) {
  const { act, pending, error } = useAct();
  const [copied, setCopied] = useState(false);
  const url = shareToken ? `${typeof window === "undefined" ? "" : window.location.origin}/brief/${shareToken}` : null;

  return (
    <Card className="mx-auto mb-10 max-w-3xl p-5 print:hidden">
      <p className="font-medium">Share this brief</p>
      <p className="mt-1 text-sm text-ink-2">
        Anyone with the link can read a live, read-only version. Note bodies and contributor emails are withheld. Revoke the link at any time.
      </p>
      {url ? (
        <div className="mt-3 space-y-3">
          <p className="break-all rounded-lg bg-sunken px-3 py-2 font-mono text-[13px]">{url}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? "Copied" : "Copy link"}</Button>
            <Button size="sm" variant="secondary" onClick={() => window.print()}>Print / save as PDF</Button>
            <Button size="sm" variant="danger" busy={pending} onClick={() => act(() => revokeShareAction(launchId))}>Revoke link</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button busy={pending} onClick={() => act(() => createShareAction(launchId))}>Create public link</Button>
          <Button variant="secondary" onClick={() => window.print()}>Print / save as PDF</Button>
        </div>
      )}
      <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>
    </Card>
  );
}
