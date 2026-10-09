import { PROTOCOL } from "monadeum-simulation/protocol";

export type Model = (typeof PROTOCOL.allowedModels)[number];

export interface Draft {
  riskTolerance: number;
  executionFrequency: number;
  assetUniverse: string[];
  informationBudget: number;
  modelConfiguration: Model;
}

const clip = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keeps any starting genome inside the protocol bounds, whatever a preset asks for. */
export function withinBounds(d: Draft): Draft {
  return {
    ...d,
    riskTolerance: clip(d.riskTolerance, PROTOCOL.riskFloor, PROTOCOL.riskCeiling),
    executionFrequency: Math.round(clip(d.executionFrequency, PROTOCOL.frequencyMin, PROTOCOL.frequencyMax)),
    informationBudget: clip(d.informationBudget, 0, PROTOCOL.informationBudgetCeiling),
  };
}

export interface Preset {
  name: string;
  description: string;
  draft: (pairs: readonly string[]) => Draft;
}

const [lowModel, midModel] = [PROTOCOL.allowedModels[0], PROTOCOL.allowedModels[PROTOCOL.allowedModels.length - 1]!];

/** Starting points only. Values are product choices for the prototype, clipped to the protocol bounds. */
export const PRESETS: Preset[] = [
  {
    name: "Cautious",
    description: "Small positions, few trades.",
    draft: (pairs) => withinBounds({ riskTolerance: 0.03, executionFrequency: 20, assetUniverse: pairs.slice(0, 1), informationBudget: 0.02, modelConfiguration: lowModel }),
  },
  {
    name: "Balanced",
    description: "A sensible starting point to learn from.",
    draft: (pairs) => withinBounds({ riskTolerance: 0.08, executionFrequency: 8, assetUniverse: pairs.slice(0, 2), informationBudget: 0.04, modelConfiguration: midModel }),
  },
  {
    name: "Explorer",
    description: "More risk and more information per tick.",
    draft: (pairs) => withinBounds({ riskTolerance: 0.18, executionFrequency: 3, assetUniverse: pairs.slice(0, 3), informationBudget: 0.08, modelConfiguration: midModel }),
  },
];

/** Testnet funding range for this prototype. A product choice, not a protocol constant. */
export const AMOUNT_MIN = 1;
export const AMOUNT_MAX = 100;
export const AMOUNT_PRESETS = [5, PROTOCOL.principal, 25] as const;

/** Parses the custom amount. Returns the error to show, or the amount. */
export function parseAmount(text: string): { amount: number } | { error: string } {
  const trimmed = text.trim();
  const range = `Enter an amount between $${AMOUNT_MIN} and $${AMOUNT_MAX} for testnet.`;
  if (!trimmed) return { error: range };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return { error: "Use a number with at most two decimals, like 12.50." };
  const amount = Number(trimmed);
  if (amount < AMOUNT_MIN || amount > AMOUNT_MAX) return { error: range };
  return { amount };
}

/** Deterministic stand-in hash so the preview identicon follows the genome. Not the on-chain genome hash. */
export function previewHash(d: Draft): string {
  const s = JSON.stringify(d);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return `0x${(h >>> 0).toString(16).padStart(8, "0")}`;
}
