/**
 * The World is the output of generation and the only input to rendering.
 * Nothing in this file knows about cameras, pixels or pixels-per-degree: a
 * renderer may be a CPU ray marcher, a WebGL scene or a physics proxy.
 */

import type { Vec3 } from '../core/math/index.ts'
import type { WorldTheme } from '../theme/types.ts'

export interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/**
 * A heightfield over a square tile, stored row major with a one cell apron so
 * bilinear sampling at the edges stays inside the array.
 *
 * Lookups outside the tile return `voidHeight`, which sits below the water
 * surface, so rays leaving the tile read as open sea rather than a hard cut.
 */
export interface TerrainField {
  resolution: number
  stride: number
  /** Width and depth of the tile in meters. */
  size: number
  /** Meters per cell. */
  cell: number
  heights: Float32Array
  /** tan(slope angle) per cell. */
  slope: Float32Array
  /**
   * Unit surface normals, three per cell.
   *
   * Baked rather than derived per pixel: a normal map interpolated smoothly
   * reads far better than finite differences taken from a heightfield, which
   * facet visibly along the grid. The renderer only ever samples this.
   */
  normals: Float32Array
  /** 0..1 per cell. */
  moisture: Float32Array
  /** Degrees Celsius per cell. */
  temperature: Float32Array
  /** sRGB bytes, three per cell. */
  albedo: Uint8Array
  /** 0..255 specular occlusion / roughness per cell. */
  roughness: Uint8Array
  minHeight: number
  maxHeight: number
  /** Requested sea level before the water pass resolves it. */
  seaLevel: number
  /** The level the water surface actually ended up at. */
  waterLevel: number
  hasWater: boolean
  /** Height returned for coordinates outside the tile. */
  voidHeight: number
  bounds: Bounds
}

export interface WaterBody {
  enabled: boolean
  level: number
  /** Fraction of the tile covered by water, 0..1. */
  coverage: number
  deepest: number
}

export interface LightSample {
  /** Unit vector from the world towards the sun. */
  direction: Vec3
  /** Pre-multiplied sun radiance: color * intensity. */
  radiance: { r: number; g: number; b: number }
  sunColor: { r: number; g: number; b: number }
  sunIntensity: number
  /** Sky radiance arriving from above, pre-multiplied by ambientIntensity. */
  skyAmbient: { r: number; g: number; b: number }
  groundAmbient: { r: number; g: number; b: number }
  ambientIntensity: number
  /** Angular radius of the sun disc in degrees. */
  sunAngularRadius: number
}

export interface WorldStats {
  generationMs: number
  cellCount: number
  waterCoverage: number
}

export interface World {
  seed: number
  theme: WorldTheme
  bounds: Bounds
  terrain: TerrainField
  water: WaterBody
  light: LightSample
  stats: WorldStats
}
