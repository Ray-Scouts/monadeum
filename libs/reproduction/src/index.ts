/**
 * Superseded reference only (EVOLUTION.md section 3.6). This package keeps the threshold-reproduction capital rule that
 * the simulation's section 3.6 reference arm and the `apps/web` sample screens still use. It is not the adopted
 * mechanism and has no NestJS module: owner-scoped reallocation and retirement live in `@monadeum/reallocation`.
 */
export { allocateCapital, assertGenomeHasNoProtocolFields, PROTOCOL_GENOME_FIELDS } from "./allocate.js";
export type { Allocation, AllocationInput } from "./allocate.js";
