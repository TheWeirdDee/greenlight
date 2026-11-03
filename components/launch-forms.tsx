"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createLaunchAction, createWorkspaceAction, updateLaunchAction } from "@/app/actions";
import { isoToLocal, localToIso } from "@/lib/format";
import { Button, ErrorNote, Field, Input, Select } from "./ui";
import { useAct } from "./use-act";

export function CreateWorkspaceForm() {
  const { act, pending, error } = useAct();
  const [name, setName] = useState("");
  return (
    <form
      className="mx-auto mt-6 max-w-md space-y-4 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        act(() => createWorkspaceAction(name));
      }}
    >
      <Field label="Workspace name" hint="Usually your project or team.">
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="Acme Labs" />}
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" busy={pending} className="w-full">Create workspace</Button>
    </form>
  );
}

const inDays = (d: number) => isoToLocal(new Date(Date.now() + d * 86_400_000).toISOString());

export function LaunchForm({
  mode,
  workspaces,
  launch,
}: {
  mode: "create" | "edit";
  workspaces?: Array<{ id: string; name: string }>;
  launch?: { id: string; name: string; tagline: string; targetAt: string };
}) {
  const router = useRouter();
  const { act, pending, error } = useAct();
  const [workspaceId, setWorkspaceId] = useState(workspaces?.[0]?.id ?? "");
  const [name, setName] = useState(launch?.name ?? "");
  const [tagline, setTagline] = useState(launch?.tagline ?? "");
  const [target, setTarget] = useState(launch ? isoToLocal(launch.targetAt) : inDays(3));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const input = { name, tagline, targetAt: localToIso(target) };
        if (mode === "create") {
          act(
            () => createLaunchAction(workspaceId, input),
            (d) => router.push(`/app/launches/${d.id}`),
          );
        } else {
          act(
            (k) => updateLaunchAction(launch!.id, input, k),
            () => router.push(`/app/launches/${launch!.id}`),
          );
        }
      }}
    >
      {mode === "create" && workspaces && workspaces.length > 1 ? (
        <Field label="Workspace">
          {(p) => (
            <Select {...p} value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          )}
        </Field>
      ) : null}
      <Field label="Launch name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="Acme token launch" />}</Field>
      <Field label="One-line description (optional)">{(p) => <Input {...p} value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={280} />}</Field>
      <Field label="Target date & time" hint="Your local time; stored and shown as UTC. This drives the countdown.">
        {(p) => <Input {...p} type="datetime-local" value={target} onChange={(e) => setTarget(e.target.value)} required />}
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" busy={pending}>{mode === "create" ? "Create launch room" : "Save changes"}</Button>
    </form>
  );
}
