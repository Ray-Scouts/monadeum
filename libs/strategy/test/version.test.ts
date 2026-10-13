import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { STRATEGY_CODE_FILE, STRATEGY_VERSION } from "../src/version.js";

test("the committed code digest is the SHA-256 of the plugin source, so the plugin cannot change unnoticed", () => {
  // dist/test/version.test.js -> package root
  const source = readFileSync(fileURLToPath(new URL(`../../${STRATEGY_CODE_FILE}`, import.meta.url)));
  const digest = `0x${createHash("sha256").update(source).digest("hex")}`;
  assert.equal(
    STRATEGY_VERSION.codeDigest,
    digest,
    `src/propose.ts changed: set codeDigest to ${digest} and raise version (ARCHITECTURE.md section 16.4, rule 7)`,
  );
});
