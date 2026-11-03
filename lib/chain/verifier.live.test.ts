import { describe, expect, it } from "vitest";
import { BASE_SEPOLIA_USDC, txUrl } from "./config";
import { createChainVerifier } from "./verifier";

/**
 * Opt-in: runs the real verifier against the live Base Sepolia RPC (`LIVE_CHAIN=1 npm run test:live`).
 *
 * The transaction below is a pre-existing, public USDC transfer found by scanning chain logs. It was
 * NOT created by Greenlight — it demonstrates that independent verification works on genuine chain
 * data. Inspect it: https://sepolia.basescan.org/tx/0x1b93805d4e4a68d01b7e0f4a67bf50bb6aa8727f8b2c378165defb872d7df0c4
 */
const TX = "0x1b93805d4e4a68d01b7e0f4a67bf50bb6aa8727f8b2c378165defb872d7df0c4" as const;
const SENDER = "0x3dc49262ee24d1b640a303603f1101c35c69801d";
const RECIPIENT = "0xa849bbad82f9edafdf9a5550cc874276138779d9";
const AMOUNT = "1000"; // 0.001 USDC (6 decimals)

describe.skipIf(!process.env.LIVE_CHAIN)("live Base Sepolia verification", () => {
  const verifier = createChainVerifier();
  const check = (over: Partial<Parameters<typeof verifier.verifyTransfer>[0]> = {}) =>
    verifier.verifyTransfer({ chainId: 84532, txHash: TX, token: BASE_SEPOLIA_USDC, recipient: RECIPIENT, minConfirmations: 2, ...over });

  it("reads token metadata from the real USDC contract", async () => {
    expect(await verifier.tokenInfo(84532, BASE_SEPOLIA_USDC)).toEqual({ decimals: 6, symbol: "USDC" });
  });

  it("verifies a real transfer from chain data alone", async () => {
    const r = await check();
    expect(r).toMatchObject({ status: "verified", amount: AMOUNT, from: SENDER, to: RECIPIENT, token: BASE_SEPOLIA_USDC.toLowerCase() });
    expect(r.confirmations).toBeGreaterThanOrEqual(2);
    expect(Number(r.blockNumber)).toBeGreaterThan(53_000_000);
    // Block time is real and recent (the chain's own clock, not ours).
    expect(r.blockTimestamp!.getTime()).toBeGreaterThan(Date.parse("2026-01-01"));
    console.log(`verified ${txUrl(TX)} → ${r.amount} base units at block ${r.blockNumber}, ${r.confirmations} confirmations`);
  });

  it("rejects the same transaction when the expected recipient differs", async () => {
    const r = await check({ recipient: "0x1111111111111111111111111111111111111111" });
    expect(r.status).toBe("rejected");
    expect(r.reason).toMatch(/not the funding recipient/);
  });

  it("treats a deeper confirmation requirement than the chain can offer as pending, not verified", async () => {
    const r = await check({ minConfirmations: 10_000_000_000 });
    expect(r.status).toBe("pending");
  });

  it("refuses a different token contract even though the transaction is real", async () => {
    const r = await check({ token: "0x4200000000000000000000000000000000000006" });
    expect(r.status).toBe("rejected");
  });

  it("reports a fabricated hash as not found", async () => {
    await expect(check({ txHash: `0x${"ab".repeat(32)}` })).rejects.toThrow(/not found/i);
  });

  it("rejects a non-Base-Sepolia chain id", async () => {
    expect((await check({ chainId: 8453 })).status).toBe("rejected");
  });
});
