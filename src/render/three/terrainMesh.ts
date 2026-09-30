/**
 * World to renderable buffers.
 *
 * The three.js specific code lives in viewer.ts. This module has no dependency
 * on three at all, which means the interesting part — turning a `World` into
 * the arrays a GPU needs — is testable in plain bun, and testable against the
 * same world data the CPU renderer uses. If this mapping and the CPU renderer
 * ever disagree about the world, these tests are where it shows up.
 */

import type { TerrainField, World } from '../../world/types.ts'
import type { WorldTheme } from '../../theme/types.ts'
import { heightAt, normalAt } from '../../world/terrain/sample.ts'
import { hexToRgb } from '../../core/color/index.ts'

export interface TerrainBuffers {
  positions: Float32Array
  normals: Float32Array
  /** Linear-light vertex colours. */
  colors: Float32Array
  heights: Float32Array
  segments: number
  vertexCount: number
}

export const srgbByteToLinear = (byte: number): number => {
  const c = byte / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/**
 * Height lookup, delegated to the world sampler.
 *
 * Not a reimplementation: the two renderers must agree about where the ground
 * is, down to the interpolation weights, or the viewer and the CPU renderer
 * would show subtly different terrain from the same world.
 */
export const sampleHeight = (field: TerrainField, x: number, z: number): number =>
  heightAt(field, x, z)

const normalScratch = { x: 0, y: 0, z: 0 }

/** Normal lookup, delegated to the world sampler for the same reason. */
export const sampleNormal = (field: TerrainField, x: number, z: number): [number, number, number] => {
  normalAt(field, x, z, normalScratch)
  return [normalScratch.x, normalScratch.y, normalScratch.z]
}

/** Nearest cell albedo, converted from sRGB bytes to linear. */
export const sampleAlbedo = (field: TerrainField, x: number, z: number): [number, number, number] => {
  const half = field.size * 0.5
  const gx = Math.min(field.stride - 1, Math.max(0, Math.round((x + half) / field.cell)))
  const gz = Math.min(field.stride - 1, Math.max(0, Math.round((z + half) / field.cell)))
  const i = (gz * field.stride + gx) * 3
  return [
    srgbByteToLinear(field.albedo[i]!),
    srgbByteToLinear(field.albedo[i + 1]!),
    srgbByteToLinear(field.albedo[i + 2]!),
  ]
}

/**
 * Build the vertex buffers for a terrain mesh.
 *
 * The grid is laid out row major to match a PlaneGeometry, and y is up, so the
 * caller only has to rotate the geometry flat.
 */
export const buildTerrainBuffers = (field: TerrainField, segments: number): TerrainBuffers => {
  const count = Math.max(2, Math.floor(segments))
  const vertexCount = (count + 1) * (count + 1)
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const colors = new Float32Array(vertexCount * 3)
  const heights = new Float32Array(vertexCount)

  for (let i = 0; i < vertexCount; i++) {
    const gx = i % (count + 1)
    const gz = (i / (count + 1)) | 0
    const x = (gx / count - 0.5) * field.size
    const z = (gz / count - 0.5) * field.size
    const h = sampleHeight(field, x, z)
    heights[i] = h

    positions[i * 3] = x
    positions[i * 3 + 1] = h
    positions[i * 3 + 2] = z

    const n = sampleNormal(field, x, z)
    normals[i * 3] = n[0]
    normals[i * 3 + 1] = n[1]
    normals[i * 3 + 2] = n[2]

    const c = sampleAlbedo(field, x, z)
    colors[i * 3] = c[0]
    colors[i * 3 + 1] = c[1]
    colors[i * 3 + 2] = c[2]
  }

  return { positions, normals, colors, heights, segments: count, vertexCount }
}

export interface SceneSummary {
  seed: number
  theme: string
  terrainVertexCount: number
  minHeight: number
  maxHeight: number
  waterLevel: number
  hasWater: boolean
  sunDirection: { x: number; y: number; z: number }
  sunColor: [number, number, number]
  skyZenith: [number, number, number]
  skyHorizon: [number, number, number]
  cloudAltitude: number
  cloudCoverage: number
  ambientSky: [number, number, number]
  ambientGround: [number, number, number]
}

const triple = (c: { r: number; g: number; b: number }): [number, number, number] => [c.r, c.g, c.b]

/**
 * Everything the three.js scene needs, resolved from world data alone.
 * Keeping it here means the viewer file is almost pure three.js plumbing.
 */
export const describeScene = (world: World, terrainVertexCount: number): SceneSummary => {
  const theme: WorldTheme = world.theme
  return {
    seed: world.seed,
    theme: theme.name,
    terrainVertexCount,
    minHeight: world.terrain.minHeight,
    maxHeight: world.terrain.maxHeight,
    waterLevel: world.terrain.waterLevel,
    hasWater: world.terrain.hasWater,
    sunDirection: { ...world.light.direction },
    sunColor: triple(world.light.sunColor),
    skyZenith: triple(hexToRgb(theme.sky.zenithColor)),
    skyHorizon: triple(hexToRgb(theme.sky.horizonColor)),
    cloudAltitude: (theme.cloud.baseAltitude + theme.cloud.topAltitude) * 0.5,
    cloudCoverage: theme.cloud.coverage,
    ambientSky: triple(world.light.skyAmbient),
    ambientGround: triple(world.light.groundAmbient),
  }
}
