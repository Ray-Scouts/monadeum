# Testnet validation report

Status: written for issue #48, item 7.3 of `docs/testnet-validation-checklist.md`. State as of 2026-10-13, 06:51 UTC, re-observed at commit `4a7856b`. This report states what was verified, what was not, and whether the system is ready for a mainnet opt-in decision. Every observation below can be repeated with the command or URL given.

## Conclusion

**The testnet deployment is not validated, and the system is not ready for a mainnet opt-in decision.** The contracts are deployed and match their source, the application is serving, and the first agent's account exists with its spend limits on chain. No spend has been validated through a bundler against the spend policy, no trade has been executed on Kuru, no x402 payment has settled, and no reallocation has run. Unrestricted autonomous mainnet trading is never the default, and this report does not change that (`BRIEF.md`, `SECURITY.md` section 10, Mainnet).

## What was verified

All observations were made on 2026-10-13 and are read-only.

| Claim | How it was checked | Result |
| --- | --- | --- |
| The three contracts on chain 10143 are the code in this repository | `python3 contracts/audit/check-deployed-bytecode.py` after `forge build`, against `https://testnet-rpc.monad.xyz`, with the source at `4a7856b` | `AgentSpendPolicy` (6716 bytes), `AgentReallocation` (9276 bytes), and `X402PaymentValidator` (6566 bytes) all MATCH, immutables masked |
| The reallocation contract's roles and parameters are as decided | `cast call` on `0x4e7500415e81017670a9cFb8763f873EE6694A7f` at block 70615562 | `operator()` and `admin()` are the Safe `0x9671dB7Ab4Afa09fe76402Ce127896b166029897`, `pendingAdmin()` is zero, `minEvaluationInterval()` 36000, `capitalFloor()` 60000, `currentEvaluation()` 0, `lastEvaluationAt()` 0, `settlementAsset()` is `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| The spend policy uses the same settlement asset | `cast call` on `0xe54512401B8fCD0DCc3f4Aa4929b99F05AbA3f05` | `settlementAsset()` is `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| The Safe is 2 of 3 | `cast call` on the Safe | `getThreshold()` 2, `VERSION()` 1.4.1, three owners |
| The first agent's account was deployed and its limits set | `cast receipt 0xd69f7a2964494334f70b26882fa9e243ca9cce752fce7fe25ff42a86968765cd` and `cast code 0x604bd1f3ec0001abbd58404595005faf925a3955` | Receipt status 1 in block 70200443, sent to the EntryPoint v0.7, 12 logs, account code present (61 bytes) |
| The indexer recorded that agent's setup | `GET https://api.monadeum.xyz/public/evidence` | 1 `account.deployed`, 1 `spend.limits-set` (per-transaction cap 1 USDC, daily cap 5 USDC), 4 `spend.call-allowed`, all in the transaction above |
| The application is serving over TLS | `curl` against `https://api.monadeum.xyz/health`, `https://app.monadeum.xyz/`, `/evidence`, `/robots.txt`, `/sitemap.xml`, `/.well-known/api-catalog` | All return 200; `/health` returns `{"status":"ok","wallets":"configured","funding":"configured"}`; the home page carries the `Link` header; the indexer reports `indexedThrough` 70615622 |

## What was not verified

Counts of public records at the time of writing, from `GET /public/evidence`: agents deployed 1, spends recorded 0, trades 0, x402 payments 0, reallocations moved 0, retired 0, evaluations advanced 0. ERC-8004 registrations: none, because no registry contract is deployed.

| Item (checklist number) | Why it is open |
| --- | --- |
| Spend validated through a bundler, over-cap refusal, daily-cap revert, delegatecall refusal (1.4 to 1.7, 6.1) | Needs a session key and a funded agent account on testnet. Passes on a fork only (`KernelV31Fork.t.sol`) |
| Session key activation and revocation on chain (1.3, 1.8, 6.5) | Built, not run on testnet |
| Real trade on Kuru, buy and close, reconciled by the worker (5.1 to 5.4, 4.5) | The WMON/USDC market is planned and simulated only: its predicted address `0x46b66f84317941eC371E7791753f35653341aeBC` has no code on 2026-10-13. The tick runner is off by default |
| x402 payment settled through a facilitator on Monad (2.2, 2.3, 2.5) | Blocked on a facilitator confirmed to accept ERC-1271 signatures for EIP-3009 and on testnet pay-to addresses |
| Relayed funding and principal accounting (4.1 to 4.4) | Built, not run on testnet |
| Reallocation and retirement run on chain (3.2 to 3.7) | Off by decision. Needs a controlled run for test agents |
| End-to-end suite against the live deployment (7.2) | Runs in CI; not run against the live deployment |
| Explorer source verification, ZeroDev sponsorship limit, Safe key custody (0.4, 0.6, 0.7) | Owner actions, recorded as open in `deploy/README.md` |
| Independent security review (7.1) | No external auditor is engaged. An automated, AI-assisted scan of the audit package is planned instead; it is not an audit |

## Readiness

- **Testnet validation:** partial. Deployment and the application layer are evidenced. The economic loop (information purchase, decision, trade, accounting) has not run end to end on the live deployment.
- **Mainnet opt-in decision:** not ready, and not to be taken from this report. The remaining preconditions are the items above plus an independent audit (`SECURITY.md` section 3), production-grade key custody (the session and x402 keys are in a local file vault on one host, which `SECURITY.md` records as not acceptable for mainnet). Persistence of every policy store, monitoring, and availability were not assessed in this report.
- **How to read testnet results:** the Kuru market on testnet is created and seeded by the team, so its price and the agents' profit and loss say nothing about the strategy's skill. Reallocation is off because the pre-registered study of issue #102 found no usable edge in the current strategy's genomes (`EVOLUTION.md` section 7).

## How to repeat this

```
cd contracts && forge build && python3 audit/check-deployed-bytecode.py
cast call 0x4e7500415e81017670a9cFb8763f873EE6694A7f "currentEvaluation()(uint256)" --rpc-url https://testnet-rpc.monad.xyz
cast receipt 0xd69f7a2964494334f70b26882fa9e243ca9cce752fce7fe25ff42a86968765cd --rpc-url https://testnet-rpc.monad.xyz
curl -s https://api.monadeum.xyz/health
curl -s https://api.monadeum.xyz/public/evidence
```

The public page `https://app.monadeum.xyz/evidence` repeats the on-chain checks in the browser for every record it lists.
