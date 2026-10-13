#!/usr/bin/env python3
"""Compares the runtime bytecode of the contracts recorded in a deployment file with a local build.

Run from contracts/, after `forge build` (not after `forge coverage`, which rebuilds without the optimizer):

    python3 audit/check-deployed-bytecode.py [deployments/monad-testnet.json] [rpc-url]

Immutables are masked on both sides using the build's immutableReferences, since their values are set by the
constructor. Read-only: it sends eth_getCode requests and nothing else. Standard library only.
Exits 1 if any contract differs.
"""
import json
import sys
import urllib.request

deployment = sys.argv[1] if len(sys.argv) > 1 else "deployments/monad-testnet.json"
rpc = sys.argv[2] if len(sys.argv) > 2 else "https://testnet-rpc.monad.xyz"


def get_code(address):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_getCode", "params": [address, "latest"]})
    request = urllib.request.Request(rpc, data=body.encode(), headers={"content-type": "application/json"})
    return bytes.fromhex(json.load(urllib.request.urlopen(request))["result"][2:])


failed = False
for name, address in json.load(open(deployment))["contracts"].items():
    artifact = json.load(open(f"out/{name}.sol/{name}.json"))["deployedBytecode"]
    local = bytearray(bytes.fromhex(artifact["object"][2:]))
    chain = bytearray(get_code(address))
    for references in artifact.get("immutableReferences", {}).values():
        for reference in references:
            start, length = reference["start"], reference["length"]
            local[start : start + length] = bytes(length)
            chain[start : start + length] = bytes(length)
    match = len(chain) > 0 and chain == local
    failed |= not match
    print(f"{name} {address} chain={len(chain)} bytes local={len(local)} bytes {'MATCH' if match else 'DIFF'}")

sys.exit(1 if failed else 0)
