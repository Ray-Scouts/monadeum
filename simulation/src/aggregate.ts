export interface Distribution {
  n: number;
  mean: number;
  stdev: number;
}

export interface WelchResult {
  meanA: number;
  meanB: number;
  t: number;
  df: number;
  p: number;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sampleStdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const sq = values.reduce((sum, value) => sum + (value - avg) ** 2, 0);
  return Math.sqrt(sq / (values.length - 1));
}

export function distribution(values: readonly number[]): Distribution {
  return { n: values.length, mean: mean(values), stdev: sampleStdev(values) };
}

/** Lanczos approximation, sufficient for the degrees of freedom this sweep produces. */
function logGamma(z: number): number {
  const p = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905,
    -0.13857109526572012, 9.98436965407898e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  let x = 0.9999999999998099;
  for (let i = 0; i < p.length; i++) x += (p[i] ?? 0) / (z + i);
  const t = z + p.length - 1.5;
  return 0.5 * Math.log(2 * Math.PI) + (z - 0.5) * Math.log(t) - t + Math.log(x);
}

function betacf(a: number, b: number, x: number): number {
  const max = 200;
  const eps = 3e-12;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= max; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < eps) break;
  }
  return h;
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const ln = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(ln);
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(a, b, x)) / a;
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value for a Welch t statistic. */
export function welchP(t: number, df: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return 1;
  const x = df / (df + t * t);
  const tail = regularizedBeta(x, df / 2, 0.5);
  return Math.min(1, Math.max(0, tail));
}

export function welch(a: readonly number[], b: readonly number[]): WelchResult {
  const meanA = mean(a);
  const meanB = mean(b);
  const va = sampleStdev(a) ** 2;
  const vb = sampleStdev(b) ** 2;
  const na = a.length;
  const nb = b.length;
  const se2 = va / na + vb / nb;
  if (se2 === 0) {
    return { meanA, meanB, t: 0, df: na + nb - 2, p: meanA === meanB ? 1 : 0 };
  }
  const t = (meanA - meanB) / Math.sqrt(se2);
  const df = se2 ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
  return { meanA, meanB, t, df, p: welchP(t, df) };
}
