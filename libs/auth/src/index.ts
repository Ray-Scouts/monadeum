export { AuthModule } from "./auth.module.js";
export { AuthService } from "./auth.service.js";
export type {
  AuthFailure,
  AuthFailureReason,
  ChallengeResult,
  LinkResult,
  OwnerWalletHandoff,
  OwnershipResult,
  Principal,
  PrincipalResult,
  SignInResult,
  WalletSignInResult,
} from "./auth.service.js";
export { PrivyTokenError, PrivyTokenVerifier } from "./privy.js";
export type { PrivyIdentity, PrivySession, PrivyVerifier } from "./privy.js";
export { MemoryChallengeStore, MemorySessionStore, MemoryUserStore } from "./store.js";
export type { ChallengeStore, LinkedWallet, SessionStore, UserRecord, UserStore, WalletChallenge, WalletProof, WalletSession } from "./store.js";
export { AuthConfigError, DEFAULT_CHALLENGE_TTL_SECONDS, DEFAULT_WALLET_SESSION_TTL_SECONDS, loadAuthConfig } from "./config.js";
export type { AuthConfig, AuthSettings } from "./config.js";
