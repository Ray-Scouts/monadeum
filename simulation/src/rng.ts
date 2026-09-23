/** Mulberry32. Same seed, same stream. No Math.random. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent stream so market noise does not depend on population size. */
export function saltedRng(seed: number, salt: number): () => number {
  const mixed = (Math.imul(seed, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  return mulberry32(mixed);
}

export function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
