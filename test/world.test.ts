import { describe, expect, test } from 'bun:test'
import { generateWorld, worldKey } from '../src/world/worldGenerator.ts'
import { generateTerrainField } from '../src/world/terrain/generator.ts'
import { resolveWaterLevel } from '../src/world/water/level.ts'
import {
  heightAt,
  heightAtExtended,
  normalAt,
  albedoAt,
  contains,
} from '../src/world/terrain/sample.ts'
import { defineTheme } from '../src/theme/resolve.ts'
import { alpine, desert } from '../src/theme/presets/index.ts'
import type { Rgb } from '../src/core/math/index.ts'
import type { TerrainField } from '../src/world/types.ts'

/** A small theme so the tests stay fast; the pipeline is identical. */
const smallTheme = () =>
  defineTheme({
    ...alpine,
    name: 'test-alpine',
    terrain: { resolution: 128, worldSize: 1200, amplitude: 400, featureSize: 500 },
  })

const hashFloats = (values: Float32Array): string => {
  // FNV over the raw bytes: exact, and catches a single changed bit.
  let h = 2166136261
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i], 16777619) >>> 0
  }
  return h.toString(16)
}

describe('generateWorld', () => {
  test('the same seed produces a byte identical world', () => {
    const theme = smallTheme()
    const a = generateWorld({ seed: 1234, theme })
    const b = generateWorld({ seed: 1234, theme })
    expect(hashFloats(a.terrain.heights)).toBe(hashFloats(b.terrain.heights))
    expect(hashFloats(a.terrain.normals)).toBe(hashFloats(b.terrain.normals))
    expect(hashFloats(a.terrain.moisture)).toBe(hashFloats(b.terrain.moisture))
    expect(a.terrain.albedo.every((v, i) => v === b.terrain.albedo[i])).toBe(true)
    expect(a.terrain.waterLevel).toBe(b.terrain.waterLevel)
  })

  test('a different seed produces a different world', () => {
    const theme = smallTheme()
    const a = generateWorld({ seed: 1, theme })
    const b = generateWorld({ seed: 2, theme })
    expect(hashFloats(a.terrain.heights)).not.toBe(hashFloats(b.terrain.heights))
  })

  test('the seed is carried into the world', () => {
    const world = generateWorld({ seed: 99, theme: smallTheme() })
    expect(world.seed).toBe(99)
    expect(worldKey(99, world.theme)).toContain('99')
  })

  test('every array has the expected length and no NaN', () => {
    const world = generateWorld({ seed: 5, theme: smallTheme() })
    const t = world.terrain
    const cells = t.stride * t.stride
    expect(t.heights.length).toBe(cells)
    expect(t.normals.length).toBe(cells * 3)
    expect(t.moisture.length).toBe(cells)
    expect(t.temperature.length).toBe(cells)
    expect(t.slope.length).toBe(cells)
    expect(t.albedo.length).toBe(cells * 3)
    expect(t.roughness.length).toBe(cells)

    for (const array of [t.heights, t.normals, t.moisture, t.temperature, t.slope]) {
      for (let i = 0; i < array.length; i++) {
        if (Number.isNaN(array[i]!)) throw new Error(`NaN at index ${i}`)
      }
    }
  })

  test('the albedo is never pure black, which would mean a broken bake', () => {
    for (const draft of [alpine, desert]) {
      const world = generateWorld({
        seed: 3,
        theme: defineTheme({ ...draft, name: 'probe', terrain: { resolution: 96, worldSize: 1000 } }),
      })
      let lit = 0
      for (let i = 0; i < world.terrain.albedo.length; i += 3) {
        if (world.terrain.albedo[i]! > 4) lit++
      }
      expect(lit / (world.terrain.albedo.length / 3)).toBeGreaterThan(0.5)
    }
  })

  test('the normal map is unit length and points up', () => {
    const world = generateWorld({ seed: 11, theme: smallTheme() })
    const n = world.terrain.normals
    for (let i = 0; i < n.length; i += 3) {
      const length = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!)
      expect(length).toBeGreaterThan(0.98)
      expect(length).toBeLessThan(1.02)
      expect(n[i + 1]!).toBeGreaterThan(0)
    }
  })

  test('the light is normalized and the sun radiance is pre-multiplied', () => {
    const world = generateWorld({ seed: 11, theme: smallTheme() })
    const d = world.light.direction
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6)
    const theme = world.theme
    expect(world.light.sunIntensity).toBe(theme.lighting.sunIntensity)
    expect(world.light.radiance.r).toBeGreaterThan(0)
  })

  test('a waterless theme reports no water instead of a negative infinity level', () => {
    const world = generateWorld({
      seed: 4,
      theme: defineTheme({
        ...alpine,
        name: 'dry',
        // Keep this cheap. A full resolution field takes seconds, which turns a
        // correctness test into a test of how busy the machine is.
        terrain: { resolution: 96, worldSize: 900 },
        water: { enabled: false },
      }),
    })
    expect(world.terrain.hasWater).toBe(false)
    expect(world.water.coverage).toBe(0)
    expect(Number.isFinite(world.terrain.waterLevel)).toBe(true)
  })

  test('a world with water places the surface above the lowest ground', () => {
    const world = generateWorld({ seed: 8, theme: smallTheme() })
    expect(world.terrain.hasWater).toBe(true)
    expect(world.terrain.waterLevel).toBeGreaterThan(world.terrain.minHeight)
    expect(world.terrain.waterLevel).toBeLessThanOrEqual(world.terrain.maxHeight)
  })

  test('reports generation statistics', () => {
    const world = generateWorld({ seed: 6, theme: smallTheme() })
    expect(world.stats.cellCount).toBe(world.terrain.stride ** 2)
    expect(world.stats.generationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('terrain sampling', () => {
  const field: TerrainField = generateTerrainField(smallTheme(), 21)

  test('heightAt clamps outside the tile rather than reading garbage', () => {
    // Reading past the end of the array would return undefined and poison
    // every downstream calculation, so out of range lookups must clamp to the
    // nearest edge, per axis independently.
    const half = field.size * 0.5
    expect(heightAt(field, 1e6, 1e6)).toBe(heightAt(field, half, half))
    expect(heightAt(field, -1e6, -1e6)).toBe(heightAt(field, -half, -half))
    expect(heightAt(field, 1e6, -1e6)).toBe(heightAt(field, half, -half))
    expect(Number.isFinite(heightAt(field, 1e9, -1e9))).toBe(true)
  })

  test('heightAtExtended returns the void height outside the tile', () => {
    expect(heightAtExtended(field, 1e6, 0)).toBe(field.voidHeight)
    expect(field.voidHeight).toBeLessThan(field.waterLevel)
  })

  test('heightAt is continuous across a cell boundary', () => {
    // The quintic interpolation weights exist to remove a derivative jump
    // here, which shows up in the image as a grid aligned crease.
    const x0 = field.cell * 3
    const z = 0
    let maxJump = 0
    let previous = heightAt(field, x0 - 1e-4, z)
    for (let i = 1; i <= 20; i++) {
      const value = heightAt(field, x0 - 1e-4 + i * 1e-5, z)
      maxJump = Math.max(maxJump, Math.abs(value - previous))
      previous = value
    }
    expect(maxJump).toBeLessThan(amplitude(field) * 0.02)
  })

  test('every sampler stays in bounds at the exact tile boundary', () => {
    // A bilinear tap reads the cell plus its +1 neighbour, so the corner cell
    // is the dangerous one. JavaScript returns undefined one past the end of
    // a typed array, which becomes a silent NaN rather than a crash.
    const half = field.size * 0.5
    const edge: Rgb = { r: 0, g: 0, b: 0 }
    const n = { x: 0, y: 0, z: 0 }
    for (const [x, z] of [
      [half, half],
      [-half, half],
      [half, -half],
      [-half, -half],
      [half, 0],
      [0, half],
    ]) {
      expect(Number.isFinite(heightAt(field, x, z)), `height at ${x},${z}`).toBe(true)
      normalAt(field, x, z, n)
      expect(
        Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z),
        `normal at ${x},${z}`,
      ).toBe(true)
      albedoAt(field, x, z, edge)
      expect(Number.isFinite(edge.r), `albedo at ${x},${z}`).toBe(true)
    }
  })

  test('contains reports the tile bounds', () => {
    expect(contains(field, 0, 0)).toBe(true)
    expect(contains(field, field.size, 0)).toBe(false)
    expect(contains(field, -field.size, 0)).toBe(false)
  })

  test('normalAt returns a unit vector pointing up, even off the tile', () => {
    const out = { x: 0, y: 0, z: 0 }
    normalAt(field, 0, 0, out)
    expect(out.y).toBeGreaterThan(0)
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 6)
    normalAt(field, 1e7, 1e7, out)
    expect(out.y).toBeCloseTo(1, 6)
  })

  test('albedoAt interpolates instead of snapping to a cell', () => {
    const out: Rgb = { r: 0, g: 0, b: 0 }
    // A hard cell boundary in the albedo would quantize the whole image.
    const a = { ...out }
    const x = field.cell * 5
    heightAt(field, x, 0)
    albedoAt(field, x - 1e-6, 0, a)
    const b: Rgb = { r: 0, g: 0, b: 0 }
    albedoAt(field, x + 1e-6, 0, b)
    expect(Math.abs(a.r - b.r)).toBeLessThan(0.01)
  })

  test('albedoAt returns black outside the tile rather than reading past the array', () => {
    const out: Rgb = { r: 1, g: 1, b: 1 }
    albedoAt(field, 1e7, 0, out)
    expect(out).toEqual({ r: 0, g: 0, b: 0 })
  })
})

/** Total relief, used as the scale for relative tolerances. */
const amplitude = (field: TerrainField): number => field.maxHeight - field.minHeight

describe('resolveWaterLevel', () => {
  const makeHeights = (values: number[]): Float32Array => new Float32Array(values)

  test('fixed mode returns the requested level', () => {
    const heights = makeHeights([0, 1, 2, 3, 4])
    const result = resolveWaterLevel(heights, {
      mode: 'fixed',
      level: 2.5,
      fraction: 0.5,
      minHeight: 0,
      maxHeight: 4,
    })
    expect(result.level).toBe(2.5)
    // heights 0,1,2 sit below 2.5
    expect(result.coverage).toBeCloseTo(0.6, 5)
  })

  test('auto mode hits the requested coverage', () => {
    // 0..99, so a 25% water level should land near 24.5.
    const heights = makeHeights(Array.from({ length: 100 }, (_, i) => i))
    const result = resolveWaterLevel(heights, {
      mode: 'auto',
      level: 0,
      fraction: 0.25,
      minHeight: 0,
      maxHeight: 99,
    })
    expect(result.level).toBeGreaterThan(20)
    expect(result.level).toBeLessThan(29)
    expect(result.coverage).toBeGreaterThan(0.2)
    expect(result.coverage).toBeLessThan(0.3)
  })

  test('reports the deepest point below the surface', () => {
    const heights = makeHeights([-50, 0, 10, 20])
    const result = resolveWaterLevel(heights, {
      mode: 'fixed',
      level: 5,
      fraction: 0.5,
      minHeight: -50,
      maxHeight: 20,
    })
    expect(result.deepest).toBe(55)
  })

  test('survives a degenerate flat field', () => {
    const heights = makeHeights(new Array(64).fill(3))
    const result = resolveWaterLevel(heights, {
      mode: 'auto',
      level: 0,
      fraction: 0.5,
      minHeight: 3,
      maxHeight: 3,
    })
    expect(Number.isFinite(result.level)).toBe(true)
    expect(Number.isFinite(result.coverage)).toBe(true)
  })
})
