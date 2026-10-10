"use client";

import { PrivyProvider, useIdentityToken, usePrivy, useWallets } from "@privy-io/react-auth";
import { useRef, type ReactNode } from "react";
import { monadTestnet } from "viem/chains";
import { sameAddress } from "@/data/api/signing";
import { WEB_CONFIG } from "@/data/config";
import { AuthProvider, CHAIN_ID, type PrivyBridge } from "./auth";

/**
 * Privy is loaded only in `api` mode, from this module, behind `next/dynamic`, so the sample build never runs it.
 * The configuration is the one the issue #19 spike validated with `@privy-io/react-auth` 3.48.0: email and Google
 * login, an embedded Ethereum wallet for users without one, and Monad testnet supplied explicitly because it is not
 * in the SDK's default chain list.
 */
export default function Providers({ children }: { children: ReactNode }) {
  if (!WEB_CONFIG.privyAppId) return <AuthProvider privy={null}>{children}</AuthProvider>;
  return (
    <PrivyProvider
      appId={WEB_CONFIG.privyAppId}
      config={{
        loginMethods: ["email", "google"],
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: monadTestnet,
        supportedChains: [monadTestnet],
      }}
    >
      <Bridge>{children}</Bridge>
    </PrivyProvider>
  );
}

function Bridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { wallets } = useWallets();
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;

  const bridge: PrivyBridge = {
    ready,
    authenticated,
    identityToken,
    login: () => login(),
    logout,
    getAccessToken,
    async providerFor(address) {
      const wallet = walletsRef.current.find((w) => sameAddress(w.address, address));
      if (!wallet) return null;
      // Typed data names its chain; wallets refuse to sign it for a chain other than the active one.
      await wallet.switchChain(CHAIN_ID).catch(() => undefined);
      return wallet.getEthereumProvider();
    },
  };
  return <AuthProvider privy={bridge}>{children}</AuthProvider>;
}
