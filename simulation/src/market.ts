import type { Bar, Regime } from "./types.js";
import { gaussian } from "./rng.js";

const NOISE = 0.01;

export function expectedDrift(regime: Regime, tick: number, price: number, ticks: number): number {
  switch (regime) {
    case "trending":
      return 0.0008;
    case "choppy":
      return 0;
    case "mean_reverting":
      return 0.2 * (1 - price);
    case "stress_flash_crash":
      return tick === Math.floor(ticks * 0.5) ? -0.3 : 0;
    default: {
      const unknown: never = regime;
      throw new Error(`unknown regime ${String(unknown)}`);
    }
  }
}

export function generateMarket(regime: Regime, ticks: number, rng: () => number): Bar[] {
  const bars: Bar[] = [];
  let price = 1;
  for (let tick = 1; tick <= ticks; tick++) {
    const drift = expectedDrift(regime, tick, price, ticks);
    const ret = drift + gaussian(rng) * NOISE;
    price = Math.max(0.01, price * (1 + ret));
    bars.push({ tick, price, ret });
  }
  return bars;
}
