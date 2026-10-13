"""
Monadeum - 06 Deployment and activation: from sign-in to an agent that may trade.

Derived from:
  ARCHITECTURE.md section 6    (wallet and account architecture, session keys,
                                implementation notes for issue 24)
  ARCHITECTURE.md section 6.1  (funding flow, relayed allocation)
  ARCHITECTURE.md section 10    (API entry: agent creation, owner-signed operations,
                                activate this agent, stop this agent)
  SECURITY.md sections 1 and 2  (session key scope, ERC-1271)
  THREAT-MODEL.md invariants 2, 8, 11, 17

On 2026-10-11 an owner signed in and created the first agent, and its Kernel
account was deployed with sponsored gas and indexed. Session key issuance
through an embedded wallet and the relayed funding transfer have not been run
on testnet (assumptions, ARCHITECTURE.md sections 6.1 and 10).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _style import *

g = new_graph(
    "deployment-activation",
    rankdir="TB",
    title="Deployment and activation: the owner signs every step that gives an agent power",
    subtitle="Signing in deploys nothing. Activation does not make an agent trade: it also needs funding and an enabled tick runner.",
    source="ARCHITECTURE.md sections 6, 6.1, 10; SECURITY.md sections 1, 2",
    ranksep="0.5",
    nodesep="0.6",
    newrank="true",
)

card(g, "s1", "1  Sign in",
     ["Privy social login, or an external wallet with an EIP-4361 challenge",
      "The owner wallet is the first wallet verified for the user"],
     kind="service", status=IMPL)
card(g, "s2", "2  Create the agent: POST /agents",
     ["Request carries a name, caps, and a preset name; any other field is refused",
      "Server builds and hashes the genome; api_agents and worker_agents rows",
      "written in one transaction; refused at the population cap (default 50)"],
     kind="service", status=IMPL)
card(g, "s3", "3  Deploy the account (owner signs one operation)",
     ["Kernel v3.1 account, owner = the root wallet, gas sponsored",
      "Same operation sets limits and one allowlist entry per target and selector,",
      "and installs the x402 validator when x402 is configured",
      "The indexer follows the account from its deployment transaction"],
     kind="chain", status=IMPL)
card(g, "s4", "4  Activate: POST /agents/:id/activate",
     ["Session key generated in memory; the owner signs one EIP-712 enable approval",
      "Call policy lists the allowlist; spend policy installed as policy and hook,",
      "never with the skip-signature flag. No user operation is sent",
      "Key is kept only if the chain would accept it now (isSessionAcceptedOnChain)"],
     kind="control", status=OFF)
card(g, "s5", "5  Fund: prepare, sign, submit",
     ["Owner signs an EIP-3009 authorization to the deployed account; a relayer submits it",
      "Principal changes only when the indexer stores the finalized Transfer"],
     kind="service", status=OFF)
card(g, "s6", "6  Ticks",
     ["From the next tick, if a signed risk policy exists and the", "tick runner is enabled (off by default)"],
     kind="neutral", status=OFF)
card(g, "stop", "Stop: POST /agents/:id/stop",
     ["Key destroyed first, then an owner-signed operation uninstalls the",
      "validator and invalidates the nonce; result read back from chain"],
     kind="threat", status=OFF)

card(g, "can", "The session key can",
     ["Call Kuru's router and the reallocation contract",
      "transfer and approve on the settlement asset, to an allowed contract",
      "approve on a traded asset, within the on-chain caps"],
     kind="control", status=OFF)
card(g, "cannot", "The session key cannot",
     ["Sign for the account through ERC-1271", "Pay an address of its choosing",
      "Change its own limits or allowlist", "Be widened by an incoming transfer"],
     kind="bad", status=OFF)

link(g, "s1", "s2", kind="control")
link(g, "s2", "s3", "owner-signed operation relayed\nto the owner's wallet", kind="control")
link(g, "s3", "s4", "account deployed and indexed", kind="control")
link(g, "s4", "s5")
link(g, "s5", "s6")
link(g, "s4", "stop", "revokes the key", kind="danger", dashed=True, constraint="false")
link(g, "s4", "can", kind="gate", constraint="false")
link(g, "can", "cannot", style="invis")

for a, b in (("s4", "can"), ("s5", "cannot"), ("s6", "stop")):
    with g.subgraph() as s:
        s.attr(rank="same")
        s.node(a)
        s.node(b)

render(g, "06-deployment-activation")
