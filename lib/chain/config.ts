/**
 * Chain safety boundary. Greenlight only verifies funding on Base Sepolia (testnet) against a
 * token allowlist. Mainnet and arbitrary tokens are deliberately unsupported in the MVP.
 */
export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;
export const BASE_SEPOLIA_EXPLORER = "https://sepolia.basescan.org";
export const BASE_SEPOLIA_DEFAULT_RPC = "https://sepolia.base.org";

/** Circle-issued testnet USDC on Base Sepolia (https://developers.circle.com/stablecoins/usdc-contract-addresses). */
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

export const FUNDING_TOKEN_ALLOWLIST: readonly string[] = [BASE_SEPOLIA_USDC];

export const txUrl = (hash: string) => `${BASE_SEPOLIA_EXPLORER}/tx/${hash}`;
export const addressUrl = (address: string) => `${BASE_SEPOLIA_EXPLORER}/address/${address}`;
