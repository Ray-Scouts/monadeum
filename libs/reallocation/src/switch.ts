/**
 * The reallocation switch (EVOLUTION.md section 3, issue #28). One configuration flag decides, for every process,
 * whether owner-scoped reallocation plans and settles anything: the worker's evaluation, the API's policy endpoint, and
 * the web copy all read it through this module, so they cannot disagree.
 *
 * - `MONADEUM_REALLOCATION_ENABLED`: `false` (the default when unset) or `true`. Any other value refuses to start.
 * - `MONADEUM_REALLOCATION_PRODUCTION_ACK`: with `MONADEUM_ENV=production`, the flag may be `true` only when this is
 *   set to exactly `REALLOCATION_PRODUCTION_ACK`. Setting it states that a new pre-registered study, on a strategy with
 *   a real signal, reported a persistent genome edge of at least the modeled size (EVOLUTION.md section 7, item 4).
 *   No such study exists; the issue #102 study was a no-go for the current strategy plugin.
 *
 * With the flag off, retirement still runs on the evaluation cadence: EVOLUTION.md section 6 makes retirement a
 * survival rule of its own, not part of reallocation, and it moves no capital (THREAT-MODEL.md invariant 15).
 */

export const REALLOCATION_ENABLED_VAR = "MONADEUM_REALLOCATION_ENABLED";
export const REALLOCATION_PRODUCTION_ACK_VAR = "MONADEUM_REALLOCATION_PRODUCTION_ACK";

/** The exact acknowledgement value production requires before reallocation may be enabled. */
export const REALLOCATION_PRODUCTION_ACK = "new-preregistered-study-reported-a-persistent-edge";

/** Why reallocation is off, in plain words, for the API and the web. The issue #102 result (EVOLUTION.md section 7). */
export const REALLOCATION_OFF_REASON =
  "Reallocation is off by default. A pre-registered study on on-chain market data found that, for the current strategy, selecting between agents adds nothing measurable, so the product runs each agent on its own capital and keeps reallocation off.";

export interface ReallocationSwitch {
  enabled: boolean;
  /** Why it is off; null when it is on. */
  reason: string | null;
}

/** Reallocation off, with the study result as the reason. The default for every process. */
export const REALLOCATION_DISABLED: ReallocationSwitch = Object.freeze({ enabled: false, reason: REALLOCATION_OFF_REASON });

/** Reallocation on. Only `loadReallocationSwitch` with the flag set, or a test, produces it. */
export const REALLOCATION_ENABLED: ReallocationSwitch = Object.freeze({ enabled: true, reason: null });

export class ReallocationSwitchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReallocationSwitchError";
  }
}

type Env = Record<string, string | undefined>;

/**
 * Reads the switch from the process environment. Unset means off. In production, on requires the acknowledgement as
 * well, or the process refuses to start; outside production the acknowledgement is not needed.
 */
export function loadReallocationSwitch(env: Env): ReallocationSwitch {
  const raw = env[REALLOCATION_ENABLED_VAR]?.trim() || "false";
  if (raw !== "true" && raw !== "false") throw new ReallocationSwitchError(`${REALLOCATION_ENABLED_VAR} must be true or false`);
  if (raw === "false") return REALLOCATION_DISABLED;
  const mode = env.MONADEUM_ENV?.trim() || "development";
  if (mode !== "development" && mode !== "production") throw new ReallocationSwitchError("MONADEUM_ENV must be development or production");
  if (mode === "production" && env[REALLOCATION_PRODUCTION_ACK_VAR]?.trim() !== REALLOCATION_PRODUCTION_ACK) {
    throw new ReallocationSwitchError(
      `MONADEUM_ENV is production and ${REALLOCATION_ENABLED_VAR} is true: refusing to start without ${REALLOCATION_PRODUCTION_ACK_VAR}=${REALLOCATION_PRODUCTION_ACK}, ` +
        "which may be set only after a new pre-registered study reports a persistent genome edge of at least the modeled size (EVOLUTION.md section 7)",
    );
  }
  return REALLOCATION_ENABLED;
}
