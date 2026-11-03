import type { Db } from "@/lib/db/types";

export interface Actor {
  id: string;
  name: string;
}

export interface FundingVerification {
  status: "verified" | "pending" | "rejected";
  reason: string | null;
  from: string | null;
  to: string | null;
  token: string | null;
  /** Token base units, decimal string. */
  amount: string | null;
  blockNumber: string | null;
  blockTimestamp: Date | null;
  confirmations: number;
}

/** The chain has no receipt for this hash (never mined, or reorganised away). */
export class TxNotFoundError extends Error {
  constructor() {
    super("Transaction not found on the network");
    this.name = "TxNotFoundError";
  }
}

export interface FundingCheckInput {
  chainId: number;
  txHash: `0x${string}`;
  token: string;
  recipient: string;
  minConfirmations: number;
}

/** Independent on-chain verification. Implementations must never trust client-supplied data. */
export interface ChainVerifier {
  tokenInfo(chainId: number, token: string): Promise<{ decimals: number; symbol: string }>;
  verifyTransfer(input: FundingCheckInput): Promise<FundingVerification>;
}

export interface UrlCheckResult {
  ok: boolean;
  status: number | null;
  /** Human-readable outcome, safe to display. */
  summary: string;
  finalUrl: string | null;
}

export interface UrlChecker {
  check(url: string): Promise<UrlCheckResult>;
}

export interface Ctx {
  db: Db;
  now: () => Date;
  chain: ChainVerifier;
  urlChecker: UrlChecker;
}

/** Display label used in the activity log for events produced by Greenlight itself. */
export const SYSTEM_ACTOR = { id: null, label: "Greenlight" } as const;
