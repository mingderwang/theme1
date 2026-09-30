/**
 * The primary ray integrator.
 *
 * One function, `renderRay`, resolves a whole ray: terrain or water or sky,
 * cloud volume composited in front of it, and aerial perspective. Secondary
 * rays (water reflections and refraction) call back into it with `depth > 0`,
 * which disables the water and cloud passes so the recursion cannot loop.
 *
 * All scratch buffers live on the context, so a render job allocates once and
 * a worker can run many jobs without interference.
 */

import type { Rgb } from '../../core/math/index.ts'
import type { RenderContext } from './context.ts'
import { shadeTerrain, traceShadow, traceTerrain, type SurfaceShade } from './terrain.ts'
import { skyRadiance } from './sky.ts'
import { shadeWater, waterPlaneHit, type WaterShadeOptions } from './water.ts'
import { marchClouds } from './clouds.ts'
import { applyAerial, applySkyHaze } from './atmosphere.ts'

export interface RenderScratch {
  /** Result of the current ray. */
  result: Rgb
  /** Secondary ray result (water reflection / refraction). */
  secondary: Rgb
  surface: SurfaceShade
}

export const createScratch = (): RenderScratch => ({
  result: { r: 0, g: 0, b: 0 },
  secondary: { r: 0, g: 0, b: 0 },
  surface: { r: 0, g: 0, b: 0 },
})

const KIND_TERRAIN = 0
const KIND_WATER = 1
const KIND_SKY = 2

/** Traces a ray and writes the linear radiance into `ctx.scratch.result`. */
export const renderRay = (
  ctx: RenderContext,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tMax: number,
  depth: number,
): Rgb => {
  const s = ctx.scratch

  // Water is tested first so the terrain march can stop at the water plane
  // instead of marching a ray that is already behind a surface.
  const tWater = depth === 0 ? waterPlaneHit(ctx, oy, dy, tMax) : -1
  const limit = tWater > 0 ? (tWater < tMax ? tWater : tMax) : tMax
  const tTerrain = traceTerrain(ctx, ox, oy, oz, dx, dy, dz, limit)

  let distance = limit
  let kind = KIND_SKY

  if (tTerrain > 0) {
    kind = KIND_TERRAIN
    distance = tTerrain
    const px = ox + dx * tTerrain
    const py = oy + dy * tTerrain
    const pz = oz + dz * tTerrain
    shadeTerrain(ctx, px, py, pz, dx, dy, dz, ctx.ditherAngle, s.surface)
    s.result.r = s.surface.r
    s.result.g = s.surface.g
    s.result.b = s.surface.b
  } else if (tWater > 0) {
    kind = KIND_WATER
    distance = tWater
    const px = ox + dx * tWater
    const py = oy + dy * tWater
    const pz = oz + dz * tWater
    shadeWater(ctx, px, py, pz, dx, dy, dz, ctx.waterShade, s.surface)
    s.result.r = s.surface.r
    s.result.g = s.surface.g
    s.result.b = s.surface.b
  } else {
    skyRadiance(ctx, dx, dy, dz, s.result)
  }

  if (depth === 0) {
    // Clouds sit between the camera and whatever the ray found.
    marchClouds(ctx, ox, oy, oz, dx, dy, dz, distance, s.result)
  }

  if (kind === KIND_SKY) {
    applySkyHaze(ctx, s.result, dy)
  } else {
    const py = oy + dy * distance
    applyAerial(ctx, s.result, distance, py, dx, dy, dz)
  }

  return s.result
}

/**
 * The callbacks `shadeWater` uses for its secondary rays. They write into
 * `ctx.scratch.secondary`, which is separate from the primary result.
 */
export const createWaterShade = (ctx: RenderContext): WaterShadeOptions => ({
  traceBackground: (ox, oy, oz, dx, dy, dz, tMax) => {
    renderRay(ctx, ox, oy, oz, dx, dy, dz, tMax, 1)
    const s = ctx.scratch
    s.secondary.r = s.result.r
    s.secondary.g = s.result.g
    s.secondary.b = s.result.b
  },
  traceShadow: (ox, oy, oz) => traceShadow(ctx, ox, oy, oz, 0),
})
