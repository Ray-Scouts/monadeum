/**
 * The strategy plugin build agents run under, as the strategy-version document of ARCHITECTURE.md section 16.4 (rule 7)
 * that is committed on chain, with the genome, when an agent's account is deployed (section 9, issue #32).
 *
 * `codeDigest` is the SHA-256 of the exact bytes of `src/propose.ts`, the plugin that turns a genome's fields and a
 * signal into an action. A test recomputes it from the file, so the plugin cannot change without this document
 * changing, and `version` is raised with every such change. An agent is committed to one version for its life: the
 * worker refuses to tick an agent whose committed strategy version is not this one (section 11, tick runner).
 *
 * Not covered by the digest: the signal the worker computes from the market for the plugin (`apps/worker`,
 * `KuruMidSignal`), and the plugin's dependencies. Both are stated limits of version 1.
 */
export const STRATEGY_VERSION = {
  schemaVersion: 1,
  strategyType: "trading",
  version: "1",
  codeDigest: "0xb0c5e5e13898461b3827cbed97782eb1367a9eab51ea4878f21ec1b69016455d",
} as const satisfies { schemaVersion: 1; strategyType: "trading"; version: string; codeDigest: `0x${string}` };

/** The file `codeDigest` is the SHA-256 of, relative to the package root. */
export const STRATEGY_CODE_FILE = "src/propose.ts";
