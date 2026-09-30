import { describe, expect, test } from 'bun:test'
import { Perlin2, Perlin3, domainWarp2 } from '../src/core/noise/index.ts'
import type { Vec3 } from '../src/core/math/index.ts'
import {
  clamp,
  clamp01,
  lerp,
  remap,
  smoothstep,
  cross,
  dot,
  normalize,
  perpendicular,
  rotateAround,
} from '../src/core/math/index.ts'

describe('math', () => {
  test('clamp and smoothstep stay in range', () => {
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
    for (const x of [-10, 0, 0.25, 0.5, 1, 10]) {
      expect(smoothstep(0, 1, x)).toBeGreaterThanOrEqual(0)
      expect(smoothstep(0, 1, x)).toBeLessThanOrEqual(1)
    }
    expect(smoothstep(0, 1, -1)).toBe(0)
    expect(smoothstep(0, 1, 2)).toBe(1)
  })

  test('smoothstep is monotonic and hits its endpoints', () => {
    let previous = -1
    for (let i = 0; i <= 100; i++) {
      const v = smoothstep(0, 1, i / 100)
      expect(v).toBeGreaterThanOrEqual(previous)
      previous = v
    }
    expect(smoothstep(0, 1, 0)).toBe(0)
    expect(smoothstep(0, 1, 1)).toBe(1)
  })

  test('remap inverts lerp', () => {
    expect(remap(5, 0, 10, 0, 100)).toBeCloseTo(50, 10)
    expect(remap(-5, 0, 10, 0, 100)).toBe(0)
    expect(remap(15, 0, 10, 0, 100)).toBe(100)
  })

  test('lerp endpoints', () => {
    expect(lerp(2, 4, 0)).toBe(2)
    expect(lerp(2, 4, 1)).toBe(4)
  })

  test('clamp01 handles the unit interval', () => {
    expect(clamp01(-0.2)).toBe(0)
    expect(clamp01(1.2)).toBe(1)
  })

  test('cross product is perpendicular to both inputs', () => {
    const a = normalize({ x: 1, y: 0, z: 0 })
    const b = normalize({ x: 0, y: 1, z: 0 })
    const c = cross(a, b)
    expect(dot(c, a)).toBeCloseTo(0, 10)
    expect(dot(c, b)).toBeCloseTo(0, 10)
  })

  test('normalize returns a unit vector and survives a zero input', () => {
    expect(Math.hypot(...Object.values(normalize({ x: 3, y: 4, z: 0 })) as number[])).toBeCloseTo(1, 10)
    expect(normalize({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 })
  })

  test('perpendicular is unit length and orthogonal', () => {
    for (const n of [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      normalize({ x: 1, y: 1, z: 1 }),
    ]) {
      const p = perpendicular(n)
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 10)
      expect(dot(p, n)).toBeCloseTo(0, 10)
    }
  })

  test('rotateAround preserves length and is identity at zero', () => {
    const v = normalize({ x: 0.3, y: 0.5, z: 0.8 })
    const axis = normalize({ x: 0, y: 1, z: 0 })
    const rotated = rotateAround(v, axis, Math.PI / 3)
    expect(Math.hypot(rotated.x, rotated.y, rotated.z)).toBeCloseTo(1, 10)
    const same = rotateAround(v, axis, 0)
    expect(same.x).toBeCloseTo(v.x, 10)
    expect(same.y).toBeCloseTo(v.y, 10)
    expect(same.z).toBeCloseTo(v.z, 10)
  })
})

describe('Perlin2', () => {
  const noise = new Perlin2(1234)

  test('is reproducible from a seed', () => {
    const a = new Perlin2(99)
    const b = new Perlin2(99)
    for (const [x, y] of [
      [0, 0],
      [1.5, 2.5],
      [-3.25, 7.75],
    ]) {
      expect(a.noise(x, y)).toBe(b.noise(x, y))
    }
  })

  test('different seeds decorrelate', () => {
    const a = new Perlin2(1)
    const b = new Perlin2(2)
    let differing = 0
    for (let i = 0; i < 100; i++) {
      if (Math.abs(a.noise(i * 0.37, i * 0.11) - b.noise(i * 0.37, i * 0.11)) > 1e-6) differing++
    }
    expect(differing).toBeGreaterThan(90)
  })

  test('stays inside a sane range and is never NaN', () => {
    for (let i = 0; i < 20000; i++) {
      const v = noise.noise((i % 173) * 0.31, Math.floor(i / 173) * 0.29)
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThan(-1.001)
      expect(v).toBeLessThan(1.001)
    }
  })

  test('handles negative coordinates', () => {
    for (const [x, y] of [
      [-0.5, -0.5],
      [-10, -3],
      [-1000, -1000],
    ]) {
      expect(Number.isFinite(noise.noise(x, y))).toBe(true)
    }
  })

  test('is zero at integer lattice points', () => {
    // Perlin noise vanishes on the integer lattice; this is a cheap check that
    // the permutation and fade wiring is right.
    for (let i = -5; i <= 5; i++) {
      expect(Math.abs(noise.noise(i, i))).toBeLessThan(1e-9)
    }
  })

  test('fbm stays in range and reduces to one octave', () => {
    const opts = { octaves: 5, lacunarity: 2, gain: 0.5 }
    for (let i = 0; i < 5000; i++) {
      const v = noise.fbm(i * 0.13, i * 0.07, opts)
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThan(-1.001)
      expect(v).toBeLessThan(1.001)
    }
    const one = { octaves: 1, lacunarity: 2, gain: 0.5 }
    expect(noise.fbm(0.3, 0.7, one)).toBeCloseTo(noise.noise(0.3, 0.7), 10)
  })

  test('ridged and billow are non negative', () => {
    const opts = { octaves: 6, lacunarity: 2.07, gain: 0.5 }
    for (let i = 0; i < 3000; i++) {
      const r = noise.ridged(i * 0.21, i * 0.09, opts, 1)
      const b = noise.billow(i * 0.21, i * 0.09, opts)
      expect(Number.isFinite(r)).toBe(true)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(1.001)
      expect(Number.isFinite(b)).toBe(true)
      expect(b).toBeGreaterThanOrEqual(-1.001)
      expect(b).toBeLessThan(1.001)
    }
  })

  test('extra octaves add high frequency detail, not amplitude', () => {
    // fBm normalizes by the total amplitude, so more octaves must not inflate
    // the range. What they should add is sign changes along a line.
    const signChanges = (octaves: number): number => {
      const n = 3000
      let changes = 0
      let previous = 0
      for (let i = 0; i < n; i++) {
        const v = noise.fbm(i * 0.05, i * 0.037, { octaves, lacunarity: 2.1, gain: 0.5 })
        const sign = v >= 0 ? 1 : -1
        if (i > 0 && sign !== previous) changes++
        previous = sign
      }
      return changes
    }
    expect(signChanges(8)).toBeGreaterThan(signChanges(1))
  })
})

describe('Perlin3', () => {
  const noise = new Perlin3(77)

  test('is reproducible and in range', () => {
    const b = new Perlin3(77)
    for (let i = 0; i < 4000; i++) {
      const x = i * 0.17
      const y = i * 0.11
      const z = i * 0.07
      const v = noise.noise(x, y, z)
      expect(v).toBe(b.noise(x, y, z))
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThan(-1.001)
      expect(v).toBeLessThan(1.001)
    }
  })

  test('fbm stays in range', () => {
    for (let i = 0; i < 2000; i++) {
      const v = noise.fbm(i * 0.13, i * 0.09, i * 0.05, {
        octaves: 4,
        lacunarity: 2.07,
        gain: 0.5,
      })
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThan(-1.001)
      expect(v).toBeLessThan(1.001)
    }
  })
})

describe('domainWarp2', () => {
  test('displaces the sample point and stays finite', () => {
    const noise = new Perlin2(5)
    const out: Vec3 = { x: 0, y: 0, z: 0 }
    for (let i = 0; i < 1000; i++) {
      domainWarp2(noise, i * 0.21, i * 0.13, 0.4, 0.6, 3, 2, 0.5, out)
      expect(Number.isFinite(out.x)).toBe(true)
      expect(Number.isFinite(out.y)).toBe(true)
    }
  })

  test('zero strength leaves the point unchanged', () => {
    const noise = new Perlin2(5)
    const out: Vec3 = { x: 0, y: 0, z: 0 }
    domainWarp2(noise, 0.4, 0.9, 0, 0.6, 3, 2, 0.5, out)
    expect(out.x).toBeCloseTo(0.4, 10)
    expect(out.y).toBeCloseTo(0.9, 10)
  })
})
