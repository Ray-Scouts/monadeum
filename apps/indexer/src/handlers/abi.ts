import { KernelV3_1AccountAbi } from "@zerodev/sdk";
import { erc20Abi, parseAbi, type Abi, type AbiEvent } from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";

/**
 * Event ABIs, taken from the installed packages wherever one ships them, never restated from memory:
 * Kernel v3.1 from `@zerodev/sdk` 5.5.10 (`KernelV3_1AccountAbi`, the account version WalletsModule deploys) and
 * EntryPoint v0.7 from viem 2.56.9 (`entryPoint07Abi`), and the ERC-20 `Transfer` event from viem's `erc20Abi`. `AgentSpendPolicy` has no published ABI artifact, so its
 * events are parsed from the declarations in `contracts/src/IAgentSpendPolicy.sol`; a test reads that file and fails
 * if the two drift apart.
 */
export function pickEvents(abi: Abi, names: readonly string[]): AbiEvent[] {
  return names.map((name) => {
    const event = abi.find((item): item is AbiEvent => item.type === "event" && item.name === name);
    if (!event) throw new Error(`event ${name} is not in the ABI`);
    return event;
  });
}

export const spendPolicyEvents = parseAbi([
  "event LimitsSet(address indexed account, uint128 perTxCap, uint128 dailyCap)",
  "event CallAllowed(address indexed account, address indexed target, bytes4 indexed selector, bool allowed)",
  "event Spent(address indexed account, uint256 amount, uint256 windowTotal)",
]);

export const kernelEvents = pickEvents(KernelV3_1AccountAbi as Abi, ["PermissionInstalled", "PermissionUninstalled", "NonceInvalidated"]);

export const entryPointEvents = pickEvents(entryPoint07Abi as Abi, ["AccountDeployed"]);

export const transferEvents = pickEvents(erc20Abi as Abi, ["Transfer"]);
