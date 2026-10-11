/**
 * What counts as funding an agent (EVOLUTION.md section 1.1, ARCHITECTURE.md section 6.1), stated where the owner
 * funds. Principal is recomputed from finalized USDC transfers from the owner wallet on record to the agent's deployed
 * account; anything else is capital in the account but does not make the agent trade.
 */
export const FUNDING_RULE =
  "Only USDC sent from your owner wallet, the wallet on record as this agent's owner, to the agent's account counts as funding, and only once that account is deployed. USDC sent from any other wallet or from an exchange, or sent before the account is deployed, stays in the account but does not fund the agent, so the agent will not trade on it.";
