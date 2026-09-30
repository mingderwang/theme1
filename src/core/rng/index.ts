/**
 * Deterministic pseudo random numbers.
 *
 * Rules for this project:
 *   - `Math.random()` is never used.
 *   - Every random stream is derived from a seed plus a stream name, so adding
 *     a new generator never shifts the numbers seen by existing generators.
 */

/** Avalanche mixer for 32 bit integers (variant of MurmurHash3's finalizer). */
const mix32 = (h: number): number => {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

/** FNV-1a over a string, then avalanche mixed. */
export const hashString = (str: string, seed = 0): number => {
  let h = (2166136261 ^ seed) >>> 0
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0
    h = mix32(h)
  }
  return mix32(h)
}

/** Combine any number of integers into one well distributed 32 bit hash. */
export const hashInts = (...values: number[]): number => {
  let h = 0x9e3779b9
  for (let i = 0; i < values.length; i++) {
    h = mix32((h ^ (values[i] | 0)) >>> 0)
    h = (Math.imul(h, 0x85ebca6b) + 0x165667b1) >>> 0
  }
  return mix32(h)
}

/** A stable [0,1) value for an integer coordinate pair/triple.
 *  Used for per pixel dithering and per cell hashing, never for state. */
export const hash01 = (...values: number[]): number => hashInts(...values) / 4294967296

/**
 * Derive a child seed from a parent seed and a stream name.
 * Subsystems take their seed from here rather than sharing one sequence, so
 * adding a generator cannot shift the numbers any other generator sees.
 */
export const streamSeed = (seed: number, name: string): number =>
  hashInts(seed >>> 0, hashString(name))

const splitmix32 = (x: number): number => mix32((x + 0x9e3779b9) >>> 0)

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0

/** xoshiro128** — small, fast, and good enough for scattering decisions. */
export class Rng {
  private s0: number
  private s1: number
  private s2: number
  private s3: number

  readonly seed: number

  constructor(seed: number) {
    this.seed = seed >>> 0
    let s = this.seed === 0 ? 0x1a2b3c4d : this.seed
    this.s0 = splitmix32(s)
    s = (s + 0x9e3779b9) >>> 0
    this.s1 = splitmix32(s)
    s = (s + 0x9e3779b9) >>> 0
    this.s2 = splitmix32(s)
    s = (s + 0x9e3779b9) >>> 0
    this.s3 = splitmix32(s)
  }

  /** A generator whose stream depends only on (seed, name). */
  static stream(seed: number, name: string): Rng {
    return new Rng(streamSeed(seed, name))
  }

  /**
   * A named child of this generator's seed.
   *
   * Depends only on the seed, not on how far this generator has been advanced,
   * so a subsystem can be handed a stream at any point in the parent's life
   * and still see the same numbers.
   */
  fork(name: string): Rng {
    return Rng.stream(this.seed, name)
  }

  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0
    const t = this.s1 << 9
    this.s2 = (this.s2 ^ this.s0) >>> 0
    this.s3 = (this.s3 ^ this.s1) >>> 0
    this.s1 = (this.s1 ^ this.s2) >>> 0
    this.s0 = (this.s0 ^ this.s3) >>> 0
    this.s2 = (this.s2 ^ t) >>> 0
    this.s3 = rotl(this.s3, 11)
    return result
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next()
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n) % Math.max(1, n)
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!
  }

  /** Standard normal, Box-Muller. */
  gaussian(): number {
    const u = 1 - this.next()
    const v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  /** Weighted choice. `weights` must be non-negative and sum > 0. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0
    for (const w of weights) total += Math.max(0, w)
    if (total <= 0) return items[0]!
    let r = this.next() * total
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i]!)
      if (r <= 0) return items[i]!
    }
    return items[items.length - 1]!
  }

  /** A unit vector on the sphere, uniform over the surface. */
  unitVector(): { x: number; y: number; z: number } {
    const z = this.range(-1, 1)
    const a = this.range(0, Math.PI * 2)
    const r = Math.sqrt(Math.max(0, 1 - z * z))
    return { x: r * Math.cos(a), y: r * Math.sin(a), z }
  }
}
