"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { acceptInvitationAction, declineInvitationAction } from "@/app/actions";
import { Button, ErrorNote, Field, Textarea } from "./ui";
import { useAct } from "./use-act";

export function InviteActions({ token }: { token: string }) {
  const router = useRouter();
  const { act, pending, error } = useAct();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="mt-6 space-y-4">
      {!declining ? (
        <div className="flex flex-wrap gap-3">
          <Button busy={pending} onClick={() => act((k) => acceptInvitationAction(token, k), (d) => d.value && router.push(`/app/launches/${d.value.launchId}`))}>
            Accept
          </Button>
          <Button variant="secondary" onClick={() => setDeclining(true)}>Decline</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Reason (optional)" hint="The founder sees this so they can arrange cover quickly.">
            {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />}
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button variant="danger" busy={pending} onClick={() => act((k) => declineInvitationAction(token, reason, k), () => router.push("/portal"))}>Decline invitation</Button>
            <Button variant="ghost" onClick={() => setDeclining(false)}>Back</Button>
          </div>
        </div>
      )}
      <p className="text-[13px] text-ink-3">Accepting is not a promise yet — you&apos;ll be asked to confirm separately. Your name and the time of each step are recorded.</p>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
