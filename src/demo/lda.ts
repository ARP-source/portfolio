/**
 * Linear discriminant analysis, the same maths as research/drift_pipeline.py (fit/predict there):
 * equal priors, z-scored features, pooled within-class covariance shrunk toward a scaled identity,
 * (1 - lambda) S + lambda * mean(diag S) * I, with lambda fixed from day 1.
 *
 * The model is kept as sufficient statistics (per-class count and mean, pooled scatter), so adding
 * recalibration windows merges exactly and refitting gives what the script gets.
 */
export interface LdaStats {
  lambda: number;
  /** Per class. */
  n: number[];
  mean: Float64Array[];
  /** Pooled within-class scatter (sum, not divided by n), d x d row-major. */
  scatter: Float64Array;
  d: number;
}

export interface LdaModel {
  W: Float64Array[];
  b: Float64Array;
}

export function statsFrom(lambda: number, n: number[], mean: number[][], scatterUpper: number[]): LdaStats {
  const d = mean[0]!.length;
  const scatter = new Float64Array(d * d);
  let k = 0;
  for (let i = 0; i < d; i++)
    for (let j = i; j < d; j++) {
      scatter[i * d + j] = scatter[j * d + i] = scatterUpper[k++]!;
    }
  return { lambda, n: [...n], mean: mean.map((m) => Float64Array.from(m)), scatter, d };
}

/**
 * Merge windows into the statistics (Chan et al.'s parallel update, per class):
 * scatter += within-batch scatter + nA nB / (nA + nB) (meanA - meanB)(meanA - meanB)^T.
 */
export function addWindows(s: LdaStats, rows: Float32Array[], labels: number[]): LdaStats {
  const { d } = s;
  const out: LdaStats = { ...s, n: [...s.n], mean: s.mean.map((m) => m.slice()), scatter: s.scatter.slice() };
  for (let c = 0; c < s.n.length; c++) {
    const idx = labels.flatMap((l, i) => (l === c ? [i] : []));
    if (!idx.length) continue;
    const nb = idx.length;
    const mb = new Float64Array(d);
    for (const i of idx) for (let j = 0; j < d; j++) mb[j]! += rows[i]![j]! / nb;
    // Within-batch scatter.
    for (const i of idx) {
      const r = rows[i]!;
      for (let a = 0; a < d; a++) {
        const da = r[a]! - mb[a]!;
        for (let b = a; b < d; b++) out.scatter[a * d + b]! += da * (r[b]! - mb[b]!);
      }
    }
    const na = out.n[c]!, ma = out.mean[c]!;
    const f = (na * nb) / (na + nb);
    for (let a = 0; a < d; a++) {
      const da = ma[a]! - mb[a]!;
      for (let b = a; b < d; b++) out.scatter[a * d + b]! += f * da * (ma[b]! - mb[b]!);
    }
    for (let j = 0; j < d; j++) ma[j] = (na * ma[j]! + nb * mb[j]!) / (na + nb);
    out.n[c] = na + nb;
  }
  // Mirror the upper triangle.
  for (let a = 0; a < d; a++) for (let b = a + 1; b < d; b++) out.scatter[b * d + a] = out.scatter[a * d + b]!;
  return out;
}

/** Solve for the discriminant weights: W_k = Sigma^-1 mu_k, b_k = -1/2 W_k . mu_k. */
export function fit(s: LdaStats): LdaModel {
  const { d, lambda } = s;
  const N = s.n.reduce((a, b) => a + b, 0);
  const sig = new Float64Array(d * d);
  let tr = 0;
  for (let i = 0; i < d; i++) tr += s.scatter[i * d + i]! / N;
  for (let i = 0; i < d * d; i++) sig[i] = (1 - lambda) * (s.scatter[i]! / N);
  for (let i = 0; i < d; i++) sig[i * d + i]! += (lambda * tr) / d;
  const L = cholesky(sig, d);
  const W = s.mean.map((mu) => cholSolve(L, d, mu));
  const b = Float64Array.from(W.map((w, k) => -0.5 * dot(w, s.mean[k]!)));
  return { W, b };
}

export function scores(m: LdaModel, x: ArrayLike<number>): number[] {
  return m.W.map((w, k) => dot(w, x) + m.b[k]!);
}

/** Class probabilities (softmax of the discriminant scores, which is LDA's posterior with equal priors). */
export function posterior(m: LdaModel, x: ArrayLike<number>): number[] {
  const s = scores(m, x);
  const top = Math.max(...s);
  const e = s.map((v) => Math.exp(v - top));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / z);
}

export function predict(m: LdaModel, x: ArrayLike<number>): number {
  const s = scores(m, x);
  let best = 0;
  for (let k = 1; k < s.length; k++) if (s[k]! > s[best]!) best = k;
  return best;
}

export function accuracy(m: LdaModel, rows: ArrayLike<number>[], labels: number[]): number {
  let ok = 0;
  for (let i = 0; i < rows.length; i++) if (predict(m, rows[i]!) === labels[i]) ok++;
  return ok / rows.length;
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function cholesky(A: Float64Array, n: number): Float64Array {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j]!;
      for (let k = 0; k < j; k++) s -= L[i * n + k]! * L[j * n + k]!;
      L[i * n + j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j * n + j]!;
    }
  return L;
}

function cholSolve(L: Float64Array, n: number, b: ArrayLike<number>): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= L[i * n + k]! * y[k]!;
    y[i] = s / L[i * n + i]!;
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]!;
    for (let k = i + 1; k < n; k++) s -= L[k * n + i]! * x[k]!;
    x[i] = s / L[i * n + i]!;
  }
  return x;
}
