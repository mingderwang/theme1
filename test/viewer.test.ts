import { describe, expect, test } from 'bun:test'
import {
  buildTerrainBuffers,
  describeScene,
  sampleAlbedo,
  sampleHeight,
  sampleNormal,
  srgbByteToLinear,
} from '../src/render/three/terrainMesh.ts'
import { generateWorld } from '../src/world/worldGenerator.ts'
import { heightAt, normalAt } from '../src/world/terrain/sample.ts'
import { defineTheme } from '../src/theme/resolve.ts'
import { alpine, desert } from '../src/theme/presets/index.ts'
import type { Rgb } from '../src/core/math/index.ts'

const tiny = (draft = alpine) =>
  defineTheme({
    ...draft,
    name: 'viewer-test',
    terrain: { resolution: 96, worldSize: 900, amplitude: 300, featureSize: 400 },
  })

describe('srgbByteToLinear', () => {
  test('matches the core colour conversion', () => {
    for (const byte of [0, 1, 64, 128, 200, 255]) {
      const c = byte / 255
      const expected = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
      expect(srgbByteToLinear(byte)).toBeCloseTo(expected, 12)
    }
  })
})

describe('viewer sampling agrees with the CPU renderer', () => {
  const world = generateWorld({ seed: 123, theme: tiny() })
  const field = world.terrain

  test('sampleHeight matches heightAt across the tile', () => {
    for (const [x, z] of [
      [0, 0],
      [100, -200],
      [-400, 350],
      [440, 440],
    ]) {
      expect(sampleHeight(field, x, z)).toBeCloseTo(heightAt(field, x, z), 4)
    }
  })

  test('sampleNormal matches normalAt across the tile', () => {
    const expected = { x: 0, y: 0, z: 0 }
    for (const [x, z] of [
      [0, 0],
      [123, -321],
      [-450, 45],
    ]) {
      const actual = sampleNormal(field, x, z)
      normalAt(field, x, z, expected)
      expect(actual[0]).toBeCloseTo(expected.x, 4)
      expect(actual[1]).toBeCloseTo(expected.y, 4)
      expect(actual[2]).toBeCloseTo(expected.z, 4)
    }
  })

  test('sampleNormal always returns a unit vector', () => {
    for (let i = 0; i < 200; i++) {
      const n = sampleNormal(field, (i % 17) * 50 - 400, ((i * 7) % 19) * 50 - 450)
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 5)
      expect(n[1]).toBeGreaterThan(0)
    }
  })

  test('sampleAlbedo returns linear light in a plausible range', () => {
    const c = sampleAlbedo(field, 0, 0)
    for (const channel of c) {
      expect(Number.isFinite(channel)).toBe(true)
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThanOrEqual(1)
    }
  })

  test('sampling outside the tile clamps instead of reading out of bounds', () => {
    expect(Number.isFinite(sampleHeight(field, 1e6, 1e6))).toBe(true)
    expect(Number.isFinite(sampleNormal(field, -1e6, 1e6)[0])).toBe(true)
    expect(sampleAlbedo(field, 1e6, 1e6).every(Number.isFinite)).toBe(true)
  })
})

describe('buildTerrainBuffers', () => {
  const world = generateWorld({ seed: 456, theme: tiny() })
  const field = world.terrain

  test('produces matching array lengths and a sane vertex count', () => {
    const segments = 64
    const buffers = buildTerrainBuffers(field, segments)
    expect(buffers.vertexCount).toBe((segments + 1) * (segments + 1))
    expect(buffers.positions.length).toBe(buffers.vertexCount * 3)
    expect(buffers.normals.length).toBe(buffers.vertexCount * 3)
    expect(buffers.colors.length).toBe(buffers.vertexCount * 3)
    expect(buffers.heights.length).toBe(buffers.vertexCount)
  })

  test('y is the height and x, z span the tile', () => {
    const buffers = buildTerrainBuffers(field, 32)
    const segments = 32
    for (let i = 0; i < buffers.vertexCount; i++) {
      const gx = i % (segments + 1)
      const gz = (i / (segments + 1)) | 0
      expect(buffers.positions[i * 3]).toBeCloseTo((gx / segments - 0.5) * field.size, 4)
      expect(buffers.positions[i * 3 + 1]).toBe(buffers.heights[i])
      expect(buffers.positions[i * 3 + 2]).toBeCloseTo((gz / segments - 0.5) * field.size, 4)
    }
  })

  test('heights fall inside the field range and are finite', () => {
    const buffers = buildTerrainBuffers(field, 48)
    for (let i = 0; i < buffers.vertexCount; i++) {
      expect(Number.isFinite(buffers.heights[i])).toBe(true)
      expect(buffers.heights[i]!).toBeGreaterThanOrEqual(field.minHeight - 1)
      expect(buffers.heights[i]!).toBeLessThanOrEqual(field.maxHeight + 1)
    }
  })

  test('no array contains a NaN, which would silently blank the mesh', () => {
    const buffers = buildTerrainBuffers(field, 64)
    for (const array of [buffers.positions, buffers.normals, buffers.colors]) {
      for (const value of array) expect(Number.isFinite(value)).toBe(true)
    }
  })

  test('is deterministic', () => {
    const a = buildTerrainBuffers(field, 32)
    const b = buildTerrainBuffers(field, 32)
    expect([...a.positions]).toEqual([...b.positions])
    expect([...a.normals]).toEqual([...b.normals])
  })

  test('clamps a silly segment count rather than allocating nothing', () => {
    const buffers = buildTerrainBuffers(field, 1)
    expect(buffers.segments).toBe(2)
    expect(buffers.vertexCount).toBe(9)
  })
})

describe('describeScene', () => {
  const world = generateWorld({ seed: 7, theme: tiny() })

  test('reports what the viewer needs, from world data only', () => {
    const summary = describeScene(world, 1024)
    expect(summary.seed).toBe(7)
    expect(summary.theme).toBe('viewer-test')
    expect(summary.terrainVertexCount).toBe(1024)
    expect(summary.hasWater).toBe(world.terrain.hasWater)
    expect(summary.waterLevel).toBe(world.terrain.waterLevel)
    expect(summary.minHeight).toBe(world.terrain.minHeight)
    expect(summary.maxHeight).toBe(world.terrain.maxHeight)
  })

  test('the sun direction it reports is normalized', () => {
    const summary = describeScene(world, 16)
    const d = summary.sunDirection
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 5)
  })

  test('sky and sun colours are finite triples', () => {
    const summary = describeScene(world, 16)
    for (const colour of [summary.skyZenith, summary.skyHorizon, summary.sunColor, summary.ambientSky]) {
      expect(colour).toHaveLength(3)
      for (const channel of colour) {
        expect(Number.isFinite(channel)).toBe(true)
      }
    }
  })

  test('a waterless world reports a finite water level', () => {
    const dry = generateWorld({
      seed: 8,
      theme: defineTheme({
        ...desert,
        name: 'dry',
        terrain: { resolution: 96, worldSize: 900 },
        water: { enabled: false },
      }),
    })
    const summary = describeScene(dry, 16)
    expect(summary.hasWater).toBe(false)
    expect(Number.isFinite(summary.waterLevel)).toBe(true)
  })
})
