/**
 * WorldGenerator: the single entry point that turns (seed, theme) into a World.
 *
 * Renderers call this and then treat the result as read only. Nothing in here
 * imports from a renderer.
 */

import { hexToRgb, scaleRgb } from '../core/color/index.ts'
import { streamSeed } from '../core/rng/index.ts'
import type { WorldTheme } from '../theme/types.ts'
import { defineTheme } from '../theme/resolve.ts'
import type { ThemeDraft } from '../theme/types.ts'
import type { Bounds, LightSample, World } from './types.ts'
import { generateTerrainField } from './terrain/generator.ts'

export interface GenerateWorldOptions {
  seed?: number
  theme?: WorldTheme
  /** A draft to merge over the theme; ignored when `theme` is given. */
  themeDraft?: ThemeDraft
  /** Reported back in `stats`; also used for the generation cache. */
  now?: () => number
}

export const DEFAULT_SEED = 1337

const buildLight = (theme: WorldTheme): LightSample => {
  const sunColor = hexToRgb(theme.lighting.sunColor)
  const skyColor = hexToRgb(theme.lighting.ambientSkyColor)
  const groundColor = hexToRgb(theme.lighting.ambientGroundColor)
  const d = theme.lighting.sunDirection
  const len = Math.hypot(d.x, d.y, d.z) || 1

  return {
    direction: { x: d.x / len, y: d.y / len, z: d.z / len },
    radiance: scaleRgb(sunColor, theme.lighting.sunIntensity),
    sunColor,
    sunIntensity: theme.lighting.sunIntensity,
    skyAmbient: scaleRgb(skyColor, theme.lighting.ambientIntensity),
    groundAmbient: scaleRgb(groundColor, theme.lighting.ambientIntensity),
    ambientIntensity: theme.lighting.ambientIntensity,
    sunAngularRadius: theme.sky.sunSize,
  }
}

/** Identity of a world: two worlds with the same identity must match byte for byte. */
export const worldKey = (seed: number, theme: WorldTheme): string =>
  `${theme.name}@${theme.version}:${seed}`

export const generateWorld = (options: GenerateWorldOptions = {}): World => {
  const theme = options.theme ?? defineTheme({ seed: options.seed ?? DEFAULT_SEED, ...options.themeDraft })
  const seed = options.seed ?? theme.seed ?? DEFAULT_SEED
  const now = options.now ?? (() => performance.now())
  const clockStart = now()

  const terrain = generateTerrainField(theme, streamSeed(seed, theme.name))

  const bounds: Bounds = terrain.bounds
  const world: World = {
    seed,
    theme,
    bounds,
    terrain,
    water: {
      enabled: terrain.hasWater,
      level: terrain.waterLevel,
      coverage: terrain.hasWater ? coverageOf(terrain) : 0,
      deepest: terrain.hasWater ? terrain.waterLevel - terrain.minHeight : 0,
    },
    light: buildLight(theme),
    stats: {
      generationMs: 0,
      cellCount: terrain.stride * terrain.stride,
      waterCoverage: 0,
    },
  }

  world.stats.generationMs = now() - clockStart
  world.stats.waterCoverage = world.water.coverage

  return world
}

const coverageOf = (terrain: { heights: Float32Array; waterLevel: number }): number => {
  if (terrain.waterLevel === -Infinity) return 0
  let below = 0
  for (let i = 0; i < terrain.heights.length; i++) {
    if (terrain.heights[i]! < terrain.waterLevel) below++
  }
  return below / terrain.heights.length
}
