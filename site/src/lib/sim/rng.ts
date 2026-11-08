// Seeded PRNG (xoshiro128**, splitmix32 seeding) plus the distributions the sim needs.
export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;
  private spare = NaN;

  constructor(seed: number) {
    let s = (seed | 0) >>> 0;
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
  }

  private u32(): number {
    const m5 = Math.imul(this.b, 5);
    const result = Math.imul((m5 << 7) | (m5 >>> 25), 9) >>> 0;
    const t = this.b << 9;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = (this.d << 11) | (this.d >>> 21);
    return result;
  }

  /** Uniform in [0,1). */
  uniform(): number {
    return this.u32() / 4294967296;
  }

  /** Uniform in (0,1]. */
  private uniformOpen(): number {
    return (this.u32() + 1) / 4294967296;
  }

  z0 = 0;
  z1 = 0;
  /** Two independent standard normals into z0/z1 (Box-Muller, no allocation). */
  normalPair(): void {
    const r = Math.sqrt(-2 * Math.log(this.uniformOpen()));
    const th = 6.283185307179586 * this.uniform();
    this.z0 = r * Math.cos(th);
    this.z1 = r * Math.sin(th);
  }

  /** Standard normal (Box-Muller, caching the second value). */
  normal(): number {
    if (!Number.isNaN(this.spare)) {
      const v = this.spare;
      this.spare = NaN;
      return v;
    }
    const r = Math.sqrt(-2 * Math.log(this.uniformOpen()));
    const th = 2 * Math.PI * this.uniform();
    this.spare = r * Math.sin(th);
    return r * Math.cos(th);
  }

  /** Gamma(shape, scale=1), Marsaglia-Tsang. */
  gamma(shape: number): number {
    if (shape < 1) {
      return this.gamma(shape + 1) * Math.pow(this.uniformOpen(), 1 / shape);
    }
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.uniformOpen();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  /** Poisson(lambda): Knuth for small, PTRS (Hoermann) for large. */
  poisson(lambda: number): number {
    if (!(lambda > 0)) return 0;
    if (lambda < 12) {
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= this.uniform();
      } while (p > L);
      return k - 1;
    }
    const slam = Math.sqrt(lambda);
    const loglam = Math.log(lambda);
    const b = 0.931 + 2.53 * slam;
    const a = -0.059 + 0.02483 * b;
    const invalpha = 1.1239 + 1.1328 / (b - 3.4);
    const vr = 0.9277 - 3.6224 / (b - 2);
    for (;;) {
      const U = this.uniform() - 0.5;
      const V = this.uniformOpen();
      const us = 0.5 - Math.abs(U);
      const k = Math.floor(((2 * a) / us + b) * U + lambda + 0.43);
      if (us >= 0.07 && V <= vr) return k;
      if (k < 0 || (us < 0.013 && V > us)) continue;
      if (
        Math.log(V) + Math.log(invalpha) - Math.log(a / (us * us) + b) <=
        -lambda + k * loglam - lgamma(k + 1)
      ) {
        return k;
      }
    }
  }

  /** Negative binomial with given mean and size (dispersion) via gamma-Poisson. */
  negBin(mean: number, size: number): number {
    if (!(mean > 0)) return 0;
    if (!(size > 0) || !Number.isFinite(size)) return this.poisson(mean);
    return this.poisson(this.gamma(size) * (mean / size));
  }
}

function lgamma(x: number): number {
  if (x < 10) {
    let prod = 1;
    while (x < 10) {
      prod *= x;
      x += 1;
    }
    return lgamma(x) - Math.log(prod);
  }
  const x2 = x * x;
  return (
    (x - 0.5) * Math.log(x) - x + 0.9189385332046727 + 1 / (12 * x) - 1 / (360 * x * x2) + 1 / (1260 * x2 * x2 * x)
  );
}
