import { createPublicClient, erc20Abi, http, isAddressEqual, parseEventLogs, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import { AppError } from "@/lib/errors";
import { TxNotFoundError } from "@/lib/services/context";
import type { ChainVerifier, FundingVerification } from "@/lib/services/context";
import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_DEFAULT_RPC, FUNDING_TOKEN_ALLOWLIST } from "./config";

export type ChainReader = Pick<
  PublicClient,
  "getChainId" | "getTransactionReceipt" | "getBlockNumber" | "getBlock" | "readContract"
>;

const rejected = (reason: string, partial: Partial<FundingVerification> = {}): FundingVerification => ({
  status: "rejected",
  reason,
  from: null,
  to: null,
  token: null,
  amount: null,
  blockNumber: null,
  blockTimestamp: null,
  confirmations: 0,
  ...partial,
});

export function createBaseSepoliaClient(rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || BASE_SEPOLIA_DEFAULT_RPC): ChainReader {
  return createPublicClient({ chain: baseSepolia, transport: http(rpcUrl, { timeout: 10_000, retryCount: 2 }) });
}

/**
 * Independent verification of an ERC-20 transfer on Base Sepolia.
 *
 * Nothing about the transaction is taken from the caller except its hash. We re-derive every
 * fact from the chain: the network, the receipt status, the emitting token contract, the
 * recipient, the amount and how deep the block is.
 */
export function createChainVerifier(client: ChainReader = createBaseSepoliaClient()): ChainVerifier {
  return {
    async tokenInfo(chainId, token) {
      if (chainId !== BASE_SEPOLIA_CHAIN_ID) throw new AppError("invalid", "Only Base Sepolia (84532) is supported");
      if (!FUNDING_TOKEN_ALLOWLIST.some((t) => t.toLowerCase() === token.toLowerCase())) {
        throw new AppError("invalid", "This token is not on the Base Sepolia allowlist");
      }
      try {
        const address = token as `0x${string}`;
        const [decimals, symbol] = await Promise.all([
          client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
          client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
        ]);
        return { decimals: Number(decimals), symbol: String(symbol) };
      } catch {
        throw new AppError("upstream", "Could not read the token contract on Base Sepolia. Try again shortly.");
      }
    },

    async verifyTransfer({ chainId, txHash, token, recipient, minConfirmations }) {
      if (chainId !== BASE_SEPOLIA_CHAIN_ID) return rejected(`Unsupported network ${chainId}; only Base Sepolia (84532)`);

      let reportedChain: number;
      try {
        reportedChain = await client.getChainId();
      } catch {
        throw new AppError("upstream", "Base Sepolia RPC is unreachable. Try again shortly.");
      }
      if (reportedChain !== chainId) {
        return rejected(`Wrong network: RPC reports chain ${reportedChain}, expected ${chainId}`);
      }

      let receipt: Awaited<ReturnType<ChainReader["getTransactionReceipt"]>>;
      try {
        receipt = await client.getTransactionReceipt({ hash: txHash });
      } catch (e) {
        if (e instanceof Error && e.name === "TransactionReceiptNotFoundError") throw new TxNotFoundError();
        throw new AppError("upstream", "Could not read the transaction from Base Sepolia. Try again shortly.");
      }

      if (receipt.status !== "success") return rejected("Transaction reverted on-chain", { blockNumber: receipt.blockNumber.toString() });

      const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).filter((log) =>
        isAddressEqual(log.address, token as `0x${string}`),
      );
      if (transfers.length === 0) {
        return rejected("No transfer of the required token was found in this transaction");
      }
      const toRecipient = transfers.filter((log) => isAddressEqual(log.args.to, recipient as `0x${string}`));
      if (toRecipient.length === 0) {
        return rejected(`Token transfer went to ${transfers[0].args.to}, not the funding recipient ${recipient}`);
      }

      const amount = toRecipient.reduce((sum, log) => sum + log.args.value, 0n);
      if (amount === 0n) return rejected("Transfer amount was zero");

      let latest: bigint;
      let block: Awaited<ReturnType<ChainReader["getBlock"]>>;
      try {
        [latest, block] = await Promise.all([
          client.getBlockNumber(),
          client.getBlock({ blockNumber: receipt.blockNumber }),
        ]);
      } catch {
        throw new AppError("upstream", "Could not read block data from Base Sepolia. Try again shortly.");
      }
      const confirmations = Number(latest - receipt.blockNumber) + 1;

      return {
        status: confirmations >= minConfirmations ? "verified" : "pending",
        reason:
          confirmations >= minConfirmations ? null : `Awaiting confirmations (${confirmations}/${minConfirmations})`,
        from: toRecipient[0].args.from.toLowerCase(),
        to: recipient.toLowerCase(),
        token: token.toLowerCase(),
        amount: amount.toString(),
        blockNumber: receipt.blockNumber.toString(),
        blockTimestamp: new Date(Number(block.timestamp) * 1000),
        confirmations,
      };
    },
  };
}
