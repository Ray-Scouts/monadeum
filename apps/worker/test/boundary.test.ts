import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The worker never depends on the indexer (ARCHITECTURE.md sections 10 and 11): agent decisions must not wait on,
// or trust, the read-model the indexer writes. This check fails if apps/worker declares or imports it.
const root = fileURLToPath(new URL("../../", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|js|mts|cts)$/.test(name) ? [path] : [];
  });
}

test("apps/worker does not depend on apps/indexer", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    assert.ok(!Object.keys(pkg[field] ?? {}).includes("@monadeum/indexer"), `${field} names @monadeum/indexer`);
  }
  const files = [...sources(join(root, "src")), ...sources(join(root, "test"))];
  assert.ok(files.length > 0);
  for (const file of files) {
    if (file.endsWith("boundary.test.ts")) continue;
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /@monadeum\/indexer|apps\/indexer|\.\.\/indexer\b|\.\.\/\.\.\/indexer\b/, file);
  }
});

test("the database packages the worker depends on do not depend on apps/indexer either", () => {
  for (const lib of ["db", "read-model"]) {
    const dir = join(root, "..", "..", "libs", lib);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      assert.ok(!Object.keys(pkg[field] ?? {}).includes("@monadeum/indexer"), `libs/${lib} ${field} names @monadeum/indexer`);
    }
    // Imports only: these packages' comments name the indexer as the read-model's writer.
    for (const file of sources(join(dir, "src"))) assert.doesNotMatch(readFileSync(file, "utf8"), /from\s+["'][^"']*indexer["']|import\(\s*["'][^"']*indexer["']/, file);
  }
});
