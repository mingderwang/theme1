/**
 * Gradient noise used by the generators.
 *
 * `Perlin2` covers terrain shape, moisture and water waves.
 * `Perlin3` covers volumetric clouds and 3D detail.
 *
 * Both take a seed and build their own permutation table, so terrain and
 * cloud noise never correlate even when they share a frequency.
 */

import { Rng, streamSeed } from '../rng/index.ts'
import type { Vec3 } from '../math/index.ts'

/** Eight evenly spaced 2D gradient directions. */
const GRAD2 = new Float32Array([
  1, 0, -1, 0, 0, 1, 0, -1, 0.70710678, 0.70710678, -0.70710678, 0.70710678, 0.70710678, -0.70710678,
  -0.70710678, -0.70710678,
])

/** Twelve gradient directions for the 3D case. */
const GRAD3 = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1,
  0, 1, -1, 0, -1, -1,
])

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)

export interface FbmOptions {
  octaves: number
  lacunarity: number
  gain: number
}

export class Perlin2 {
  private readonly perm = new Uint8Array(512)

  constructor(seed: number) {
    const rng = Rng.stream(seed, 'perlin2')
    const base = new Uint8Array(256)
    for (let i = 0; i < 256; i++) base[i] = i
    for (let i = 255; i > 0; i--) {
      const j = rng.int(i + 1)
      const tmp = base[i]!
      base[i] = base[j]!
      base[j] = tmp
    }
    for (let i = 0; i < 512; i++) this.perm[i] = base[i & 255]!
  }

  /** Single octave, roughly -1..1. */
  noise(x: number, y: number): number {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const X = xi & 255
    const Y = yi & 255

    const aa = this.perm[this.perm[X]! + Y]! & 7
    const ab = this.perm[this.perm[X]! + Y + 1]! & 7
    const ba = this.perm[this.perm[X + 1]! + Y]! & 7
    const bb = this.perm[this.perm[X + 1]! + Y + 1]! & 7

    const u = fade(xf)
    const v = fade(yf)

    const g = (index: number, dx: number, dy: number): number =>
      GRAD2[index * 2]! * dx + GRAD2[index * 2 + 1]! * dy

    const x1 = lerp(g(aa, xf, yf), g(ba, xf - 1, yf), u)
    const x2 = lerp(g(ab, xf, yf - 1), g(bb, xf - 1, yf - 1), u)
    return lerp(x1, x2, v)
  }

  /** Fractal Brownian motion, normalized to about -1..1. */
  fbm(x: number, y: number, opts: FbmOptions): number {
    let sum = 0
    let amp = 1
    let norm = 0
    let fx = x
    let fy = y
    for (let i = 0; i < opts.octaves; i++) {
      sum += amp * this.noise(fx, fy)
      norm += amp
      amp *= opts.gain
      fx *= opts.lacunarity
      fy *= opts.lacunarity
    }
    return norm > 0 ? sum / norm : 0
  }

  /** Ridged multifractal, 0..1 with sharp crests. `sharpness` < 1 widens
   *  the ridges, > 1 pinches them into needles. */
  ridged(x: number, y: number, opts: FbmOptions, sharpness = 1): number {
    let sum = 0
    let amp = 1
    let norm = 0
    let weight = 1
    let fx = x
    let fy = y
    for (let i = 0; i < opts.octaves; i++) {
      let n = 1 - Math.abs(this.noise(fx, fy))
      n = Math.pow(n, 2)
      n *= weight
      weight = Math.min(1, Math.max(0, n * 2))
      sum += amp * n
      norm += amp
      amp *= opts.gain
      fx *= opts.lacunarity
      fy *= opts.lacunarity
    }
    if (norm <= 0) return 0
    const v = sum / norm
    return Math.pow(Math.max(0, Math.min(1, v)), sharpness)
  }

  /** Billow noise: |noise| folded, gives puffy lobes. Used for cloud bases. */
  billow(x: number, y: number, opts: FbmOptions): number {
    let sum = 0
    let amp = 1
    let norm = 0
    let fx = x
    let fy = y
    for (let i = 0; i < opts.octaves; i++) {
      sum += amp * Math.abs(this.noise(fx, fy))
      norm += amp
      amp *= opts.gain
      fx *= opts.lacunarity
      fy *= opts.lacunarity
    }
    return norm > 0 ? (sum / norm) * 2 - 1 : 0
  }
}

export class Perlin3 {
  private readonly perm = new Uint8Array(512)

  constructor(seed: number) {
    const rng = Rng.stream(seed, 'perlin3')
    const base = new Uint8Array(256)
    for (let i = 0; i < 256; i++) base[i] = i
    for (let i = 255; i > 0; i--) {
      const j = rng.int(i + 1)
      const tmp = base[i]!
      base[i] = base[j]!
      base[j] = tmp
    }
    for (let i = 0; i < 512; i++) this.perm[i] = base[i & 255]!
  }

  noise(x: number, y: number, z: number): number {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const zi = Math.floor(z)
    const xf = x - xi
    const yf = y - yi
    const zf = z - zi
    const X = xi & 255
    const Y = yi & 255
    const Z = zi & 255

    const a = this.perm[X]! + Y
    const aa = this.perm[a]! + Z
    const ab = this.perm[a + 1]! + Z
    const b = this.perm[X + 1]! + Y
    const ba = this.perm[b]! + Z
    const bb = this.perm[b + 1]! + Z

    const u = fade(xf)
    const v = fade(yf)
    const w = fade(zf)

    const g = (index: number, dx: number, dy: number, dz: number): number =>
      GRAD3[(index % 12) * 3]! * dx +
      GRAD3[(index % 12) * 3 + 1]! * dy +
      GRAD3[(index % 12) * 3 + 2]! * dz

    const x1 = lerp(g(this.perm[aa]!, xf, yf, zf), g(this.perm[ba]!, xf - 1, yf, zf), u)
    const x2 = lerp(g(this.perm[ab]!, xf, yf - 1, zf), g(this.perm[bb]!, xf - 1, yf - 1, zf), u)
    const y1 = lerp(x1, x2, v)

    const x3 = lerp(
      g(this.perm[aa + 1]!, xf, yf, zf - 1),
      g(this.perm[ba + 1]!, xf - 1, yf, zf - 1),
      u,
    )
    const x4 = lerp(
      g(this.perm[ab + 1]!, xf, yf - 1, zf - 1),
      g(this.perm[bb + 1]!, xf - 1, yf - 1, zf - 1),
      u,
    )
    const y2 = lerp(x3, x4, v)

    return lerp(y1, y2, w)
  }

  fbm(x: number, y: number, z: number, opts: FbmOptions): number {
    let sum = 0
    let amp = 1
    let norm = 0
    let fx = x
    let fy = y
    let fz = z
    for (let i = 0; i < opts.octaves; i++) {
      sum += amp * this.noise(fx, fy, fz)
      norm += amp
      amp *= opts.gain
      fx *= opts.lacunarity
      fy *= opts.lacunarity
      fz *= opts.lacunarity
    }
    return norm > 0 ? sum / norm : 0
  }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * Two passes of Perlin used as a domain warp. Returns the warped coordinate
 * so callers can feed it into another noise evaluation.
 */
export const domainWarp2 = (
  noise: Perlin2,
  x: number,
  y: number,
  strength: number,
  frequency: number,
  octaves: number,
  lacunarity: number,
  gain: number,
  out: Vec3,
): Vec3 => {
  const opts: FbmOptions = { octaves, lacunarity, gain }
  const qx = noise.fbm(x * frequency, y * frequency, opts)
  const qy = noise.fbm(x * frequency + 5.2, y * frequency + 1.3, opts)
  const rx = noise.fbm(x * frequency + 4 * qx + 1.7, y * frequency + 4 * qy + 9.2, opts)
  const ry = noise.fbm(x * frequency + 4 * qx + 8.3, y * frequency + 4 * qy + 2.8, opts)
  out.x = x + strength * rx
  out.y = y + strength * ry
  return out
}
