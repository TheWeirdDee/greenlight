"use client";

import { useState } from "react";
import { Button } from "../ui";
import type { IssuedInvite } from "./recovery";

/**
 * Shows a freshly issued invitation link. The secret exists only in this browser session — the
 * database keeps just its hash — so the founder copies it now or re-issues a new link later.
 * Dispatch is deliberately manual: Greenlight never messages anyone on the founder's behalf.
 */
export function InviteBanner({ invite, onDismiss, launchName }: { invite: IssuedInvite; onDismiss: () => void; launchName: string }) {
  const [copied, setCopied] = useState<"link" | "message" | null>(null);
  const url = `${window.location.origin}/invite/${invite.token}`;
  const message = `Hi ${invite.label.split(/[ —-]/)[0]}, I'm coordinating the ${launchName} launch on Greenlight. Could you confirm "${invite.requirementTitle}"? Open this private link to accept or decline: ${url}`;

  const copy = async (what: "link" | "message") => {
    try {
      await navigator.clipboard.writeText(what === "link" ? url : message);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div role="status" className="rounded-2xl border border-wait/40 bg-wait-bg p-4 sm:p-5">
      <p className="font-medium text-wait">Invitation ready for {invite.label}</p>
      <p className="mt-1 text-sm text-ink-2">
        Send this private link yourself. It works once, expires in 7 days, and is shown only now — we store only a hash of it.
      </p>
      <p className="mt-3 break-all rounded-lg bg-surface px-3 py-2 font-mono text-[13px]">{url}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => copy("link")}>{copied === "link" ? "Copied" : "Copy link"}</Button>
        <Button size="sm" variant="secondary" onClick={() => copy("message")}>{copied === "message" ? "Copied" : "Copy draft message"}</Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>
      </div>
    </div>
  );
}
