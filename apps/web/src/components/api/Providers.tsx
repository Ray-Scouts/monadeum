"use client";

import { PrivyProvider, useIdentityToken, usePrivy, useWallets } from "@privy-io/react-auth";
import { useEffect, useRef } from "react";
import { monadTestnet } from "viem/chains";
import { sameAddress } from "@/data/api/signing";
import { WEB_CONFIG } from "@/data/config";
import { CHAIN_ID, type PrivyBridge } from "./auth";

/**
 * Privy is loaded only in `api` mode, from this module, behind `next/dynamic`, so the sample build never runs it.
 * The configuration is the one the issue #19 spike validated with `@privy-io/react-auth` 3.48.0: email and Google
 * login, an embedded Ethereum wallet for users without one, and Monad testnet supplied explicitly because it is not
 * in the SDK's default chain list.
 *
 * The app is not rendered inside this provider: the sign-in page and the session check must not wait for the SDK to
 * download. The provider reports its state upward through `onBridge` instead, and `ApiRoot` hands it to `AuthProvider`.
 */
export default function PrivyLoader({ onBridge }: { onBridge(bridge: PrivyBridge): void }) {
  if (!WEB_CONFIG.privyAppId) return null;
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
      <Bridge onBridge={onBridge} />
    </PrivyProvider>
  );
}

function Bridge({ onBridge }: { onBridge(bridge: PrivyBridge): void }) {
  const privy = usePrivy();
  const { identityToken } = useIdentityToken();
  const { wallets } = useWallets();
  // The SDK's functions and wallet list are read through refs, so a new bridge is published only when the state the
  // session check depends on changes.
  const latest = useRef({ privy, wallets });
  latest.current = { privy, wallets };
  const { ready, authenticated } = privy;

  useEffect(() => {
    onBridge({
      ready,
      authenticated,
      identityToken,
      login: () => latest.current.privy.login(),
      logout: () => latest.current.privy.logout(),
      getAccessToken: () => latest.current.privy.getAccessToken(),
      async providerFor(address) {
        const wallet = latest.current.wallets.find((w) => sameAddress(w.address, address));
        if (!wallet) return null;
        // Typed data names its chain; wallets refuse to sign it for a chain other than the active one.
        await wallet.switchChain(CHAIN_ID).catch(() => undefined);
        return wallet.getEthereumProvider();
      },
    });
  }, [onBridge, ready, authenticated, identityToken]);
  return null;
}
