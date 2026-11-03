"use client";

import { useState } from "react";
import { addRequirementAction } from "@/app/actions";
import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_USDC } from "@/lib/chain/config";
import { localToIso } from "@/lib/format";
import type { RoomRequirement } from "@/lib/services/room";
import { Button, Card, ErrorNote, Eyebrow, Field, Input, Select, Textarea } from "../ui";
import { useAct } from "../use-act";

const kinds = [
  { value: "commitment", label: "Commitment — a person confirms they will do it", hint: "Satisfied when the invited contributor confirms before the deadline." },
  { value: "deliverable", label: "Deliverable — a person confirms and submits evidence", hint: "Satisfied when the confirmed contributor submits evidence on time. Evidence is a submitted claim." },
  { value: "url_check", label: "Site check — a public page must be reachable", hint: "Greenlight fetches the URL itself. Verified evidence only." },
  { value: "funding", label: "Funding — USDC must arrive on Base Sepolia", hint: "Credited only from transfers Greenlight verifies on-chain." },
] as const;

export function AddRequirement({ launchId, existing }: { launchId: string; existing: RoomRequirement[] }) {
  const { act, pending, error } = useAct();
  const [open, setOpen] = useState(existing.length === 0);
  const [kind, setKind] = useState<(typeof kinds)[number]["value"]>("commitment");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [mandatory, setMandatory] = useState(true);
  const [deps, setDeps] = useState<string[]>([]);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("5");
  const [confs, setConfs] = useState("2");

  const reset = () => {
    setTitle("");
    setDescription("");
    setDeadline("");
    setDeps([]);
    setOpen(false);
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Eyebrow>Requirements</Eyebrow>
          <h2 className="mt-1 font-display text-2xl">Define what &ldquo;ready&rdquo; means</h2>
        </div>
        <Button variant={open ? "ghost" : "secondary"} size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Close" : "Add requirement"}
        </Button>
      </div>
      {open ? (
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            act(
              (k) =>
                addRequirementAction(
                  launchId,
                  {
                    title,
                    description,
                    kind,
                    mandatory,
                    deadlineAt: deadline ? localToIso(deadline) : null,
                    dependsOn: deps,
                    funding:
                      kind === "funding"
                        ? { chainId: BASE_SEPOLIA_CHAIN_ID, token: BASE_SEPOLIA_USDC, recipient: recipient.trim(), amount: amount.trim(), minConfirmations: Number(confs) }
                        : null,
                  },
                  k,
                ),
              reset,
            );
          }}
        >
          <Field label="Type" hint={kinds.find((k) => k.value === kind)?.hint}>
            {(p) => (
              <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                {kinds.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Title">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={140} placeholder={kind === "funding" ? "Campaign budget secured" : kind === "url_check" ? "Landing page is live" : "Announcement thread posted"} />}</Field>
          <Field label="Details (optional)">{(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />}</Field>
          {kind === "funding" ? (
            <div className="space-y-4 rounded-xl border border-line bg-paper p-4">
              <p className="text-sm text-ink-2">
                Test funds only. Greenlight verifies transfers of <span className="font-mono">USDC</span> on <strong>Base Sepolia</strong> and holds nothing itself.
              </p>
              <Field label="Recipient wallet (0x…)" hint="Where the funds must arrive. Use a wallet you control.">
                {(p) => <Input {...p} className="font-mono" value={recipient} onChange={(e) => setRecipient(e.target.value)} required placeholder="0x…" spellCheck={false} autoComplete="off" />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount (USDC)">{(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />}</Field>
                <Field label="Confirmations required" hint="Blocks that must follow the transfer.">{(p) => <Input {...p} type="number" min={1} max={64} value={confs} onChange={(e) => setConfs(e.target.value)} required />}</Field>
              </div>
            </div>
          ) : null}
          <Field label="Deadline" hint="Your local time. Past this moment an unsatisfied requirement expires.">{(p) => <Input {...p} type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />}</Field>
          {existing.length > 0 ? (
            <fieldset>
              <legend className="text-sm font-medium">Depends on</legend>
              <p className="text-[13px] text-ink-3">This requirement can&apos;t count until these are satisfied.</p>
              <div className="mt-1.5 space-y-1.5">
                {existing.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={deps.includes(o.id)} onChange={(e) => setDeps(e.target.checked ? [...deps, o.id] : deps.filter((d) => d !== o.id))} />
                    {o.title}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} className="h-4 w-4" />
            Mandatory — the launch can&apos;t be READY without it
          </label>
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" busy={pending}>Add requirement</Button>
        </form>
      ) : null}
    </Card>
  );
}
