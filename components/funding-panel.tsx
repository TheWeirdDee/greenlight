"use client";

import { useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { erc20Abi, isAddressEqual, parseUnits } from "viem";
import { baseSepolia } from "viem/chains";
import {
  WagmiProvider,
  useConnect,
  useConnection,
  useConnectors,
  useDisconnect,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { submitFundingTxAction } from "@/app/actions";
import { addressUrl, txUrl } from "@/lib/chain/config";
import { fmtAmount, fmtDateTime, shortAddr, shortHash } from "@/lib/format";
import type { RoomRequirement } from "@/lib/services/room";
import { formatUnits } from "@/lib/units";
import { wagmiConfig } from "@/lib/wagmi";
import { Pill } from "./status";
import { Button, ErrorNote, Field, Input } from "./ui";
import { useAct } from "./use-act";

const queryClient = new QueryClient();

export function FundingPanel(props: { requirement: RoomRequirement; verifiedUnits: string; frozen: boolean }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Panel {...props} />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function Panel({ requirement: req, verifiedUnits, frozen }: { requirement: RoomRequirement; verifiedUnits: string; frozen: boolean }) {
  const f = req.funding!;
  const target = BigInt(f.amount);
  const verified = BigInt(verifiedUnits);
  const remaining = target > verified ? target - verified : 0n;
  const pct = target === 0n ? 0 : Number((verified * 100n) / target);

  const { address, chainId, isConnected } = useConnection();
  const connect = useConnect();
  const connectors = useConnectors();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const write = useWriteContract();
  const { act, pending: submitting, error, setError } = useAct();

  const [amount, setAmount] = useState(() => formatUnits(remaining.toString(), f.decimals));
  const [sentHash, setSentHash] = useState<`0x${string}` | null>(null);
  const [manualHash, setManualHash] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const submittedFor = useRef<string | null>(null);

  const wrongNetwork = isConnected && chainId !== baseSepolia.id;
  const isRecipient = address ? isAddressEqual(address, f.recipient as `0x${string}`) : false;

  const balance = useReadContract({
    address: f.token as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: baseSepolia.id,
    query: { enabled: Boolean(address) && !wrongNetwork },
  });
  const receipt = useWaitForTransactionReceipt({ hash: sentHash ?? undefined, chainId: baseSepolia.id });

  const submit = (hash: string) =>
    act(
      (key) => submitFundingTxAction(req.id, hash, key),
      (d) => {
        const status = "status" in d ? d.status : null;
        setNote(status === "verified" ? "Verified on-chain. Readiness has been recalculated." : status === "pending" ? "Recorded. Waiting for more block confirmations — it will count automatically once confirmed." : "Already recorded.");
        setManualHash("");
      },
    );

  // Once our own transfer is mined, hand the hash to the server — which re-verifies everything itself.
  useEffect(() => {
    if (receipt.isSuccess && sentHash && submittedFor.current !== sentHash) {
      submittedFor.current = sentHash;
      submit(sentHash);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess, sentHash]);

  const send = () => {
    setError(null);
    setNote(null);
    let units: bigint;
    try {
      units = parseUnits(amount, f.decimals);
    } catch {
      setError("Enter a valid amount.");
      return;
    }
    if (units <= 0n) return setError("Amount must be greater than zero.");
    write.mutate(
      { address: f.token as `0x${string}`, abi: erc20Abi, functionName: "transfer", args: [f.recipient as `0x${string}`, units], chainId: baseSepolia.id },
      { onSuccess: (h) => setSentHash(h), onError: (e) => setError(e.message.split("\n")[0].slice(0, 160)) },
    );
  };

  const busy = write.isPending || receipt.isLoading || submitting;
  const injectedConnector = connectors[0];

  return (
    <div className="mt-4 space-y-5 rounded-xl border border-line bg-paper p-4">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="tnum font-mono text-sm">
            <span className="text-lg font-semibold">{fmtAmount(verified.toString(), f.decimals, f.symbol)}</span>
            <span className="text-ink-3"> verified of </span>
            {fmtAmount(f.amount, f.decimals, f.symbol)}
          </p>
          <p className="text-[13px] text-ink-3">Base Sepolia testnet · {f.minConfirmations} confirmations required</p>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(pct, 100)} aria-label="Verified funding">
          <div className="h-full rounded-full bg-[var(--ready-lamp)] transition-[width] duration-700" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <p className="mt-2 text-[13px] text-ink-2">
          Recipient{" "}
          <a className="font-mono underline underline-offset-2" href={addressUrl(f.recipient)} target="_blank" rel="noreferrer">
            {shortAddr(f.recipient)}
          </a>{" "}
          · Token{" "}
          <a className="font-mono underline underline-offset-2" href={addressUrl(f.token)} target="_blank" rel="noreferrer">
            {f.symbol} {shortAddr(f.token)}
          </a>
        </p>
      </div>

      {req.fundingTxs.length > 0 ? (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
          {req.fundingTxs.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5">
              <a className="font-mono underline underline-offset-2" href={txUrl(t.txHash)} target="_blank" rel="noreferrer">
                {shortHash(t.txHash)}
              </a>
              <span className="tnum font-mono">{t.amount ? fmtAmount(t.amount, f.decimals, f.symbol) : "—"}</span>
              <span className="text-[12px] text-ink-3">{t.blockTimestamp ? fmtDateTime(t.blockTimestamp) : `${t.confirmations ?? 0} conf.`}</span>
              <Pill tone={t.status === "verified" ? "ready" : t.status === "pending" ? "wait" : "block"}>{t.status === "verified" ? "On-chain verified" : t.status === "pending" ? "Confirming" : "Rejected"}</Pill>
            </li>
          ))}
        </ul>
      ) : null}

      {frozen ? (
        <p className="text-sm text-ink-3">The founder has recorded a launch decision; funding is locked.</p>
      ) : remaining === 0n ? (
        <p className="text-sm text-ready">Funding target met by verified transactions.</p>
      ) : (
        <div className="space-y-4">
          {!isConnected ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" busy={connect.isPending} onClick={() => connect.mutate({ connector: injectedConnector })} disabled={!injectedConnector}>
                Connect wallet
              </Button>
              <p className="text-[13px] text-ink-3">Use a browser wallet on Base Sepolia. No mainnet, no real funds.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <p>
                  Connected <span className="font-mono">{address ? shortAddr(address) : ""}</span>
                  {balance.data !== undefined ? <span className="text-ink-3"> · {fmtAmount(balance.data.toString(), f.decimals, f.symbol)}</span> : null}
                </p>
                <button className="text-[13px] text-ink-3 underline underline-offset-2" onClick={() => disconnect.mutate()}>
                  Disconnect
                </button>
              </div>
              {isRecipient ? (
                <ErrorNote>This wallet is the funding recipient. Send from a different wallet so the transfer is a real movement of funds.</ErrorNote>
              ) : null}
              {wrongNetwork ? (
                <div className="flex flex-wrap items-center gap-3">
                  <ErrorNote>Wrong network. Greenlight only accepts Base Sepolia (chain 84532).</ErrorNote>
                  <Button variant="secondary" size="sm" busy={switchChain.isPending} onClick={() => switchChain.mutate({ chainId: baseSepolia.id })}>
                    Switch to Base Sepolia
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-full max-w-[14rem]">
                    <Field label={`Amount (${f.symbol})`}>{(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
                  </div>
                  <Button onClick={send} busy={busy} disabled={isRecipient}>
                    {write.isPending ? "Confirm in wallet…" : receipt.isLoading ? "Waiting for block…" : submitting ? "Verifying…" : `Send ${f.symbol}`}
                  </Button>
                </div>
              )}
              {balance.data !== undefined && balance.data === 0n && !wrongNetwork ? (
                <p className="text-[13px] text-ink-2">
                  No test {f.symbol} in this wallet. Get some from{" "}
                  <a className="underline underline-offset-2" href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                    Circle&apos;s faucet
                  </a>{" "}
                  (choose Base Sepolia) and a little test ETH for gas.
                </p>
              ) : null}
              {sentHash ? (
                <p className="text-[13px] text-ink-2">
                  Sent:{" "}
                  <a className="font-mono underline underline-offset-2" href={txUrl(sentHash)} target="_blank" rel="noreferrer">
                    {shortHash(sentHash)}
                  </a>
                </p>
              ) : null}
            </div>
          )}

          <form
            className="flex flex-wrap items-end gap-3 border-t border-line pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              setNote(null);
              submit(manualHash);
            }}
          >
            <div className="min-w-0 flex-1 basis-64">
              <Field label="Already sent a transfer?" hint="Paste its transaction hash. Greenlight re-checks it on-chain; the hash alone proves nothing.">
                {(p) => <Input {...p} className="font-mono" placeholder="0x…" value={manualHash} onChange={(e) => setManualHash(e.target.value)} spellCheck={false} autoComplete="off" />}
              </Field>
            </div>
            <Button type="submit" variant="secondary" busy={submitting} disabled={!manualHash.trim()}>
              Verify transaction
            </Button>
          </form>
        </div>
      )}

      <ErrorNote>{error}</ErrorNote>
      {note ? (
        <p role="status" className="rounded-lg border border-ready/30 bg-ready-bg px-3 py-2 text-sm text-ready">
          {note}
        </p>
      ) : null}
    </div>
  );
}
