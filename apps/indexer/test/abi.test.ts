import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { KernelV3_1AccountAbi } from "@zerodev/sdk";
import { toEventSelector, toEventSignature, type AbiEvent } from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";
import { entryPointEvents, kernelEvents, spendPolicyEvents } from "../src/handlers/abi.js";

const solidity = readFileSync(new URL("../../../../contracts/src/IAgentSpendPolicy.sol", import.meta.url), "utf8");

/** Canonical `Name(type indexed name,...)` forms of every event declared in the Solidity source. */
function declaredEvents(source: string): string[] {
  return [...source.matchAll(/^\s*event\s+(\w+)\(([^)]*)\);/gm)].map(([, name, params]) => {
    const parts = params!.split(",").map((p) => p.trim().split(/\s+/).join(" "));
    return `${name}(${parts.join(", ")})`;
  });
}

function humanReadable(e: AbiEvent): string {
  return `${e.name}(${e.inputs.map((i) => [i.type, i.indexed ? "indexed" : null, i.name].filter(Boolean).join(" ")).join(", ")})`;
}

test("the spend policy event ABI matches contracts/src/IAgentSpendPolicy.sol, including indexed parameters", () => {
  assert.deepEqual(spendPolicyEvents.map(humanReadable).sort(), declaredEvents(solidity).sort());
});

test("Kernel and EntryPoint events come from the installed package ABIs", () => {
  for (const e of kernelEvents) assert.ok((KernelV3_1AccountAbi as readonly unknown[]).includes(e), `${e.name} is the SDK's own item`);
  assert.ok((entryPoint07Abi as readonly unknown[]).includes(entryPointEvents[0]));
  // Recorded so a package upgrade that changes a signature fails here rather than silently matching nothing.
  assert.deepEqual(kernelEvents.map((e) => toEventSignature(e)), ["PermissionInstalled(bytes4,uint32)", "PermissionUninstalled(bytes4)", "NonceInvalidated(uint32)"]);
  assert.deepEqual(kernelEvents.map((e) => e.inputs.some((i) => i.indexed)), [false, false, false]);
  assert.equal(toEventSignature(entryPointEvents[0]!), "AccountDeployed(bytes32,address,address,address)");
  assert.equal(entryPointEvents[0]!.inputs[1]!.name, "sender");
  assert.equal(entryPointEvents[0]!.inputs[1]!.indexed, true);
  assert.equal(toEventSelector(entryPointEvents[0]!).length, 66);
});
