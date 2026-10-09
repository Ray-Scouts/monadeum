import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { App } from "./App";
import { chain } from "./config";

const appId = import.meta.env.VITE_PRIVY_APP_ID;
if (!appId) throw new Error("VITE_PRIVY_APP_ID is not set, see .env.example");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PrivyProvider
      appId={appId}
      config={{
        // Both methods must be enabled in the Privy dashboard. Remove one here if it is not.
        loginMethods: ["email", "google"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        // Monad testnet is not in Privy's default chain list, so it is supplied from viem/chains.
        defaultChain: chain,
        supportedChains: [chain],
      }}
    >
      <App />
    </PrivyProvider>
  </StrictMode>,
);
