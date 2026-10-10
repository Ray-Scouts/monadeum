// Run as a separate process by the round-trip test: prints the hashes of the fixtures as one JSON line.
import { hashGenome, hashReallocationPolicy, hashStrategyVersion } from "../../src/index.js";
import { GENOME, POLICY, STRATEGY } from "./documents.js";

process.stdout.write(
  JSON.stringify({ genome: hashGenome(GENOME), strategy: hashStrategyVersion(STRATEGY), policy: hashReallocationPolicy(POLICY) }),
);
