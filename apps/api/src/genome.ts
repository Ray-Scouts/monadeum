import type { AgentRecord as WorkerAgentRecord } from "@monadeum/agent-registry";
import { hashGenome, normalizeGenome, type GenomeV1 } from "@monadeum/commitment";
import { ALLOWED_INFORMATION_SOURCES, type GenomePreset } from "@monadeum/strategy/presets";
import type { Hex } from "viem";

// A new agent's genome, built server-side from a named preset and the deployment's trading pair (EVOLUTION.md
// section 1.1). Nothing here reads a request: the client names a preset, and the API validates the name before it
// gets here.

/** A trading pair as the risk policy's `allowedPairs` and the worker's market name it, for example `WETH/USDC`. */
export const PAIR = /^[A-Z0-9]{1,16}\/[A-Z0-9]{1,16}$/;

export interface BuiltGenome {
  /** The normalized document, exactly the object `libs/commitment` hashes. Base-unit amounts are decimal strings. */
  document: GenomeV1;
  hash: Hex;
}

/** The genome of a new agent created from `preset`, trading `pair`, and its section 16.4 hash. */
export function buildGenome(preset: GenomePreset, pair: string): BuiltGenome {
  if (!PAIR.test(pair)) throw new Error(`invalid trading pair ${pair}`);
  const document = normalizeGenome({
    schemaVersion: 1,
    strategyType: "trading",
    assetUniverse: [pair],
    riskTolerance: preset.riskTolerance,
    executionFrequency: preset.executionFrequency,
    timeHorizon: preset.timeHorizon,
    entryThreshold: preset.entryThreshold,
    exitThreshold: preset.exitThreshold,
    informationSources: [...preset.informationSources],
    informationBudget: preset.informationBudget,
    modelConfiguration: preset.modelConfiguration,
  }) as unknown as GenomeV1;
  return { document, hash: hashGenome(document) };
}

/**
 * The part of the genome the worker reads, derived from the committed document so the two cannot disagree. The pair
 * the worker trades is the first element of the asset universe; a preset genome has exactly one.
 */
export function workerGenome(document: GenomeV1): WorkerAgentRecord["genome"] {
  const sources = document.informationSources.filter((s) => (ALLOWED_INFORMATION_SOURCES as readonly string[]).includes(s));
  if (sources.length !== document.informationSources.length) throw new Error("genome names an information source that is not allow-listed");
  const pair = document.assetUniverse[0];
  if (pair === undefined) throw new Error("genome has an empty asset universe");
  return {
    riskTolerance: document.riskTolerance,
    executionFrequency: document.executionFrequency,
    informationBudget: BigInt(document.informationBudget),
    informationSources: sources as WorkerAgentRecord["genome"]["informationSources"],
    pair,
    assetUniverse: [...document.assetUniverse],
  };
}
