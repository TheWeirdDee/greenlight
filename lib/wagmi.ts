import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

/**
 * Wallet configuration. Base Sepolia only: the MVP never offers a mainnet chain, so a wallet
 * cannot be pointed at real funds through this UI. `injected()` covers browser wallets
 * (MetaMask, Coinbase Wallet extension, Rabby, ...) without extra services or API keys.
 */
export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [injected()],
  transports: { [baseSepolia.id]: http() },
  ssr: true,
});
