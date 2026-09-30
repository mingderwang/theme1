/**
 * The terrain generator: theme + seed -> TerrainField.
 *
 * Pipeline per cell:
 *   1. a low frequency shape field decides land vs ocean (the coastline)
 *   2. a range mask decides where mountains are allowed to be tall
 *   3. domain warped fBm and ridged noise give the actual relief
 *   4. thermal erosion knocks off anything steeper than the talus angle
 *   5. the water level is resolved from the resulting histogram
 *   6. slope, moisture and temperature are derived, then albedo is baked
 */

import { Perlin2, domainWarp2 } from '../../core/noise/index.ts'
import { clamp01, lerp, smoothstep, type Vec3 } from '../../core/math/index.ts'
import type { WorldTheme } from '../../theme/types.ts'
import type { Bounds, TerrainField } from '../types.ts'
import { resolveWaterLevel } from '../water/level.ts'
import { sanitizeHeights, thermalErode } from './erosion.ts'
import { bakeNormals } from './normals.ts'
import { blurSquare } from './smooth.ts'
import { bakeTerrainAppearance } from './albedo.ts'
import { streamSeed } from '../../core/rng/index.ts'

const warpScratch: Vec3 = { x: 0, y: 0, z: 0 }

export const generateTerrainField = (theme: WorldTheme, seed: number): TerrainField => {
  const t = theme.terrain
  const resolution = Math.max(16, Math.floor(t.resolution))
  const stride = resolution + 1
  const size = t.worldSize
  const cell = size / resolution
  const count = stride * stride

  const shapeNoise = new Perlin2(streamSeed(seed, 'terrain.shape'))
  const rangeNoise = new Perlin2(streamSeed(seed, 'terrain.range'))
  const baseNoise = new Perlin2(streamSeed(seed, 'terrain.base'))
  const detailNoise = new Perlin2(streamSeed(seed, 'terrain.detail'))
  const seabedNoise = new Perlin2(streamSeed(seed, 'terrain.seabed'))
  const moistureNoise = new Perlin2(streamSeed(seed, 'terrain.moisture'))
  const climateNoise = new Perlin2(streamSeed(seed, 'terrain.climate'))
  const variationNoise = new Perlin2(streamSeed(seed, 'terrain.variation'))

  const heights = new Float32Array(count)
  const slope = new Float32Array(count)
  const moisture = new Float32Array(count)
  const temperature = new Float32Array(count)
  const albedo = new Uint8Array(count * 3)
  const roughness = new Uint8Array(count)

  const shapeFreq = size / t.shapeFeatureSize
  const detailFreq = size / t.featureSize

  const detailOpts = {
    octaves: t.octaves,
    lacunarity: t.lacunarity,
    gain: t.gain,
  }
  const warpOpts = { octaves: 3, lacunarity: 2.0, gain: 0.5 }

  const half = size * 0.5
  let minHeight = Infinity
  let maxHeight = -Infinity

  for (let j = 0; j < stride; j++) {
    const wz = j * cell - half
    const v = wz / size
    for (let i = 0; i < stride; i++) {
      const wx = i * cell - half
      const u = wx / size
      const index = j * stride + i

      // 1. land / ocean mask
      const shape = shapeNoise.fbm(u * shapeFreq, v * shapeFreq, {
        octaves: t.shapeOctaves,
        lacunarity: 2.0,
        gain: 0.55,
      })
      const landMaskBase = smoothstep(
        t.seaThreshold - t.coastSoftness,
        t.seaThreshold + t.coastSoftness,
        shape,
      )

      // Taper the world into open sea at the tile border, so the edge of the
      // generated tile is never a cliff into nothing.
      let landMask = landMaskBase
      if (t.edgeFalloff > 0) {
        const radius = Math.hypot(u, v) / 0.70710678
        const edge = 1 - smoothstep(1 - Math.max(0.02, t.edgeWidth), 1, radius)
        landMask *= 1 - t.edgeFalloff * (1 - edge)
      }

      // 2. where mountains are allowed
      const range = clamp01(
        0.5 + 0.5 * rangeNoise.fbm(u * shapeFreq * 2.1 + 11.3, v * shapeFreq * 2.1 - 4.7, {
          octaves: 3,
          lacunarity: 2.0,
          gain: 0.5,
        }),
      )

      // 3. relief
      domainWarp2(
        detailNoise,
        u * detailFreq,
        v * detailFreq,
        t.warpStrength,
        t.warpFrequency,
        warpOpts.octaves,
        warpOpts.lacunarity,
        warpOpts.gain,
        warpScratch,
      )
      const px = warpScratch.x
      const pz = warpScratch.y

      const smooth = clamp01(0.5 + 0.5 * detailNoise.fbm(px, pz, detailOpts))
      const ridge = detailNoise.ridged(px, pz, detailOpts, t.ridgeSharpness)
      const ridgedMix = t.ridgedMix * (0.4 + 0.6 * range)
      const relief = lerp(smooth, ridge, ridgedMix)

      // broad basins and plateaus under the detail
      const broad = clamp01(
        0.5 + 0.5 * baseNoise.fbm(u * shapeFreq * 1.4 - 3.1, v * shapeFreq * 1.4 + 7.9, {
          octaves: 3,
          lacunarity: 2.0,
          gain: 0.5,
        }),
      )

      // power curve keeps more of the world in low ground and sharpens peaks
      const relief01 = Math.pow(clamp01(broad * 0.42 + relief * 0.58), 1.25)
      const elevation = t.amplitude * relief01

      // 4. combine land and sea floor
      const seabed =
        t.seaDepth *
        Math.pow(1 - landMask, 1.4) *
        (0.75 + 0.25 * (0.5 + 0.5 * seabedNoise.fbm(px * 0.35, pz * 0.35, warpOpts)))

      const height = landMask * elevation - seabed
      heights[index] = height
      if (height < minHeight) minHeight = height
      if (height > maxHeight) maxHeight = height
    }
  }

  if (!Number.isFinite(minHeight)) minHeight = 0
  if (!Number.isFinite(maxHeight)) maxHeight = 0

  sanitizeHeights(heights, minHeight)
  thermalErode(heights, resolution, cell, t.erosion)

  // re-derive the range after erosion
  minHeight = Infinity
  maxHeight = -Infinity
  for (let i = 0; i < count; i++) {
    const h = heights[i]!
    if (h < minHeight) minHeight = h
    if (h > maxHeight) maxHeight = h
  }

  // 5. water
  const waterEnabled = theme.water.enabled
  const waterResult = waterEnabled
    ? resolveWaterLevel(heights, {
        mode: theme.water.levelMode === 'fixed' ? 'fixed' : t.seaLevelMode,
        level: theme.water.level,
        fraction: t.waterFraction,
        minHeight,
        maxHeight,
      })
    : { level: minHeight, coverage: 0, deepest: 0 }

  // A world with no water still gets a finite, harmless level so nothing
  // downstream has to special case an infinity. `hasWater` is the flag that
  // says whether the surface is real.
  const waterLevel = waterEnabled ? waterResult.level : minHeight

  // 6. derived fields
  // A raw per cell gradient is too noisy to drive material masks: thresholding
  // it paints single cell rock patches across the whole world. Smooth it so
  // the rock and snow bands follow real landforms instead of the grid.
  blurSquare(slope, stride, 2)
  for (let j = 0; j < stride; j++) {
    for (let i = 0; i < stride; i++) {
      const index = j * stride + i
      const x = i * cell - half
      const z = j * cell - half
      const h = heights[index]!

      const hL = heights[j * stride + Math.max(0, i - 1)]!
      const hR = heights[j * stride + Math.min(stride - 1, i + 1)]!
      const hD = heights[Math.max(0, j - 1) * stride + i]!
      const hU = heights[Math.min(stride - 1, j + 1) * stride + i]!
      const gradX = (hR - hL) / (2 * cell)
      const gradZ = (hU - hD) / (2 * cell)
      slope[index] = Math.sqrt(gradX * gradX + gradZ * gradZ)

      const m = t.moisture
      const u = x / size
      const v = z / size
      let wetness = clamp01(
        0.5 + 0.5 * moistureNoise.fbm(u * m.frequency, v * m.frequency, {
          octaves: m.octaves,
          lacunarity: 2.0,
          gain: m.gain,
        }),
      )
      // low ground near the water is wetter, steep ground sheds water
      // Extra moisture near the water, on a long scale. A short scale makes
      // vegetation appear as a narrow band tracing an elevation contour, which
      // reads as a painted stripe rather than as damp ground.
      const nearness = waterEnabled
        ? 1 - clamp01((h - waterLevel) / 700)
        : 1 - clamp01((h - minHeight) / Math.max(1, maxHeight - minHeight))
      wetness += m.seaInfluence * nearness - m.runoff * clamp01(slope[index]! / 1.4)
      // Expand around the midpoint: see MoistureTheme.contrast.
      wetness = clamp01((wetness - 0.5) * Math.max(0.1, m.contrast) + 0.5)
      moisture[index] = clamp01(wetness)

      const c = t.climate
      const above = Math.max(0, h - (waterEnabled ? waterLevel : minHeight))
      temperature[index] =
        c.seaLevelTemperature -
        c.lapseRate * above +
        c.variation *
          climateNoise.fbm(u * c.frequency * size * 0.001 + 21.5, v * c.frequency * size * 0.001 - 13.2, {
            octaves: 3,
            lacunarity: 2.0,
            gain: 0.5,
          })
    }
  }

  // Normals are baked from the final, post-erosion heights.
  const normals = new Float32Array(count * 3)
  const bounds: Bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half }
  const field: TerrainField = {
    resolution,
    stride,
    size,
    cell,
    heights,
    slope,
    normals,
    moisture,
    temperature,
    albedo,
    roughness,
    minHeight,
    maxHeight,
    seaLevel: t.seaLevel,
    waterLevel,
    hasWater: waterEnabled && waterResult.coverage > 0.004,
    voidHeight: waterEnabled ? waterLevel - t.seaDepth * 1.5 - 20 : minHeight - 1000,
    bounds,
  }

  bakeNormals(field, 1)
  bakeTerrainAppearance(
    field,
    t,
    theme.palette,
    // When there is no water the "shoreline" is pushed far below the terrain so
    // no beach or seabed colouring appears.
    waterEnabled ? waterLevel : minHeight - 10000,
    variationNoise,
  )

  return field
}
