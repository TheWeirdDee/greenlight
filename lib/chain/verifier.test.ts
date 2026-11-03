import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type Log, type TransactionReceipt } from "viem";
import { BASE_SEPOLIA_USDC } from "./config";
import { createChainVerifier, type ChainReader } from "./verifier";

const RECIPIENT = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x3333333333333333333333333333333333333333" as const;
const SENDER = "0x2222222222222222222222222222222222222222" as const;
const HASH = `0x${"ab".repeat(32)}` as const;
const FAKE_TOKEN = "0x4444444444444444444444444444444444444444" as const;

const transferLog = (token: `0x${string}`, to: `0x${string}`, value: bigint): Log =>
  ({
    address: token,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: SENDER, to } }),
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    blockNumber: 1000n,
    logIndex: 0,
    transactionIndex: 0,
    transactionHash: HASH,
    blockHash: `0x${"cd".repeat(32)}`,
    removed: false,
  }) as Log;

function reader(over: {
  chainId?: number;
  status?: "success" | "reverted";
  logs?: Log[];
  head?: bigint;
  notFound?: boolean;
  rpcDown?: boolean;
}): ChainReader {
  return {
    getChainId: async () => {
      if (over.rpcDown) throw new Error("down");
      return over.chainId ?? 84532;
    },
    getTransactionReceipt: async () => {
      if (over.notFound) throw Object.assign(new Error("not found"), { name: "TransactionReceiptNotFoundError" });
      return { status: over.status ?? "success", logs: over.logs ?? [], blockNumber: 1000n } as unknown as TransactionReceipt;
    },
    getBlockNumber: async () => over.head ?? 1010n,
    getBlock: async () => ({ timestamp: 1_793_000_000n }) as never,
    readContract: (async ({ functionName }: { functionName: string }) => (functionName === "decimals" ? 6 : "USDC")) as never,
  };
}

const check = (r: ChainReader, over: Partial<Parameters<ReturnType<typeof createChainVerifier>["verifyTransfer"]>[0]> = {}) =>
  createChainVerifier(r).verifyTransfer({
    chainId: 84532,
    txHash: HASH,
    token: BASE_SEPOLIA_USDC,
    recipient: RECIPIENT,
    minConfirmations: 2,
    ...over,
  });

describe("on-chain funding verification (viem)", () => {
  it("verifies a successful USDC transfer to the recipient and reads amount/time from the chain", async () => {
    const r = await check(reader({ logs: [transferLog(BASE_SEPOLIA_USDC, RECIPIENT, 5_000_000n)] }));
    expect(r).toMatchObject({
      status: "verified",
      amount: "5000000",
      from: SENDER,
      to: RECIPIENT,
      token: BASE_SEPOLIA_USDC.toLowerCase(),
      blockNumber: "1000",
      confirmations: 11,
    });
    expect(r.blockTimestamp?.toISOString()).toBe(new Date(1_793_000_000_000).toISOString());
  });

  it("sums multiple transfers to the recipient inside one transaction (batched payouts)", async () => {
    const r = await check(
      reader({ logs: [transferLog(BASE_SEPOLIA_USDC, RECIPIENT, 2_000_000n), transferLog(BASE_SEPOLIA_USDC, RECIPIENT, 3_000_000n), transferLog(BASE_SEPOLIA_USDC, OTHER, 9_000_000n)] }),
    );
    expect(r.amount).toBe("5000000");
  });

  it("matches addresses case-insensitively", async () => {
    const r = await check(reader({ logs: [transferLog(BASE_SEPOLIA_USDC, RECIPIENT, 1n)] }), {
      token: BASE_SEPOLIA_USDC.toUpperCase().replace("0X", "0x"),
      recipient: RECIPIENT.toUpperCase().replace("0X", "0x"),
    });
    expect(r.status).toBe("verified");
  });

  it("is pending until enough confirmations accumulate, and reports the count", async () => {
    const r = await check(reader({ head: 1000n, logs: [transferLog(BASE_SEPOLIA_USDC, RECIPIENT, 5_000_000n)] }));
    expect(r).toMatchObject({ status: "pending", confirmations: 1 });
    expect(r.reason).toContain("1/2");
    const ok = await check(reader({ head: 1001n, logs: [transferLog(BASE_SEPOLIA_USDC, RECIPIENT, 5_000_000n)] }));
    expect(ok.status).toBe("verified");
  });

  it("rejects a transfer to the wrong recipient", async () => {
    const r = await check(reader({ logs: [transferLog(BASE_SEPOLIA_USDC, OTHER, 5_000_000n)] }));
    expect(r.status).toBe("rejected");
    expect(r.reason).toMatch(/not the funding recipient/);
    expect(r.amount).toBeNull();
  });

  it("rejects a Transfer event emitted by a different (look-alike) token contract", async () => {
    const r = await check(reader({ logs: [transferLog(FAKE_TOKEN, RECIPIENT, 5_000_000n)] }));
    expect(r.status).toBe("rejected");
    expect(r.reason).toMatch(/required token/);
  });

  it("rejects reverted transactions even if they carry logs", async () => {
    const r = await check(reader({ status: "reverted", logs: [transferLog(BASE_SEPOLIA_USDC, RECIPIENT, 5_000_000n)] }));
    expect(r.status).toBe("rejected");
    expect(r.reason).toMatch(/reverted/);
  });

  it("rejects a transaction with no token transfer at all (e.g. a plain ETH send)", async () => {
    expect((await check(reader({ logs: [] }))).status).toBe("rejected");
  });

  it("rejects when the RPC reports a different chain than expected", async () => {
    const r = await check(reader({ chainId: 8453, logs: [transferLog(BASE_SEPOLIA_USDC, RECIPIENT, 5_000_000n)] }));
    expect(r.status).toBe("rejected");
    expect(r.reason).toMatch(/Wrong network/);
  });

  it("rejects any chain other than Base Sepolia before touching the RPC", async () => {
    const r = await check(reader({}), { chainId: 8453 });
    expect(r.status).toBe("rejected");
    expect(r.reason).toMatch(/Unsupported network/);
  });

  it("reports a missing receipt as not-found, and RPC failures as upstream errors (never as verified)", async () => {
    await expect(check(reader({ notFound: true }))).rejects.toThrow(/not found/i);
    await expect(check(reader({ rpcDown: true }))).rejects.toMatchObject({ code: "upstream" });
  });

  it("reads token metadata from the contract and refuses unlisted tokens or chains", async () => {
    const v = createChainVerifier(reader({}));
    expect(await v.tokenInfo(84532, BASE_SEPOLIA_USDC)).toEqual({ decimals: 6, symbol: "USDC" });
    await expect(v.tokenInfo(84532, FAKE_TOKEN)).rejects.toThrow(/allowlist/);
    await expect(v.tokenInfo(8453, BASE_SEPOLIA_USDC)).rejects.toThrow(/Base Sepolia/);
  });
});
