/**
 * Terrain intersection, shadow rays, ambient occlusion and terrain shading.
 *
 * A heightfield is not a distance field, so sphere tracing stalls on it. The
 * integrator instead takes a step proportional to the distance travelled,
 * which bounds the geometric error, and then bisects the interval where the
 * ray crossed the surface.
 */

import { clamp01 } from '../../core/math/index.ts'
import type { Rgb } from '../../core/math/index.ts'
import { heightAtExtended, albedoAt, normalAt } from '../../world/terrain/sample.ts'
import type { RenderContext } from './context.ts'

export interface Ray {
  x: number
  y: number
  z: number
}

/**
 * Distance to the terrain along the ray, or -1 if the ray misses.
 * `tMax` bounds the search; the caller passes the water plane distance so we
 * never march a ray that is already behind a surface.
 *
 * The step is the smaller of a distance-proportional term and half the vertical
 * gap to the surface. Because the direction is normalized, the gap shrinks by
 * at most `step` per step, so the second term cannot step through the surface:
 * no holes in ridgelines, and the march covers far more ground on the same
 * step budget than a pure distance-proportional step.
 */
export const traceTerrain = (
  ctx: RenderContext,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tMax: number,
): number => {
  const { field, options } = ctx
  const { stepScale, minStep, maxSteps, refineSteps } = options

  let t = 0
  let previousT = 0
  let h = oy - heightAtExtended(field, ox, oz)

  // Starting inside the terrain: report the entry point.
  if (h <= 0) return 0

  for (let i = 0; i < maxSteps; i++) {
    const distanceStep = t * stepScale
    const gapStep = h * 0.5
    const step = distanceStep < gapStep ? distanceStep : gapStep
    previousT = t
    t += step < minStep ? minStep : step
    if (t >= tMax) return -1

    const x = ox + dx * t
    const z = oz + dz * t
    h = oy + dy * t - heightAtExtended(field, x, z)

    if (h <= 0) {
      // The ray crossed between previousT and t. Bisect for a clean hit.
      let lo = previousT
      let hi = t
      for (let k = 0; k < refineSteps; k++) {
        const mid = (lo + hi) * 0.5
        const hm = oy + dy * mid - heightAtExtended(field, ox + dx * mid, oz + dz * mid)
        if (hm <= 0) hi = mid
        else lo = mid
      }
      return hi
    }
  }

  return -1
}

/**
 * Soft shadow visibility towards the sun, 0..1.
 *
 * The penumbra comes from comparing the ray's clearance above the terrain with
 * the clearance it would have over flat ground. A simple `clearance / distance`
 * ratio is wrong here: over flat ground the clearance *is* proportional to the
 * distance, so that metric reports heavy shadow on a level plain. Normalizing
 * by `t * sunY` instead makes flat ground read as fully lit and only tightens
 * the shadow where terrain actually rises into the ray.
 */
export const traceShadow = (
  ctx: RenderContext,
  ox: number,
  oy: number,
  oz: number,
  jitter: number,
): number => {
  const theme = ctx.world.theme
  if (!theme.lighting.shadows.enabled) return 1

  const { field, options } = ctx
  let dx = ctx.sunX
  let dy = ctx.sunY
  let dz = ctx.sunZ

  const jitterAngle = jitter * ctx.ditherAngle
  if (jitterAngle !== 0) {
    // Rotate the sun direction slightly per pixel, so a hard shadow edge
    // becomes a dithered penumbra that the supersampler averages away.
    // The angle comes from a hash of the pixel index, so it needs no RNG
    // state and is identical on every run.
    const ca = Math.cos(jitterAngle)
    const sa = Math.sin(jitterAngle)
    const ax = Math.abs(dy) < 0.9 ? 0 : 1
    const ay = Math.abs(dy) < 0.9 ? 1 : 0
    const az = 0
    const proj = dx * ax + dy * ay + dz * az
    const cx = dy * az - dz * ay
    const cy = dz * ax - dx * az
    const cz = dx * ay - dy * ax
    const k = 1 - ca
    const rx = dx * ca + cx * sa + ax * proj * k
    const ry = dy * ca + cy * sa + ay * proj * k
    const rz = dz * ca + cz * sa + az * proj * k
    dx = rx
    dy = ry
    dz = rz
  }

  const maxDistance = options.shadowMaxDistance
  const sunY = Math.max(0.12, dy)
  const softness = 6 * options.shadowSoftness + 2
  const minStep = options.shadowMinStep

  let t = 0
  let h = 0
  let visibility = 1

  for (let i = 0; i < options.shadowSteps; i++) {
    // Same gap limited step as the primary ray: grow with distance, but never
    // more than half the clearance to the surface. Without this the ray skips
    // over the shoulder of a ridge and lands deep inside it, which turns the
    // shadow edge into a hard stair step along the heightfield grid.
    const distanceStep = t * 0.15
    const gapStep = h > 0 ? h * 0.5 : minStep
    const step = distanceStep < gapStep ? distanceStep : gapStep
    t += step < minStep ? minStep : step
    if (t > maxDistance) break

    h = oy + dy * t - heightAtExtended(field, ox + dx * t, oz + dz * t)
    if (h < 0) {
      // Soften by how far past the surface this sample landed, instead of
      // snapping to fully occluded.
      return clamp01(visibility * Math.max(0, 1 + h / (minStep * 1.5)))
    }
    const ratio = (softness * h) / (t * sunY)
    if (ratio < visibility) visibility = ratio
  }

  return clamp01(visibility)
}

/** Hemispheric occlusion from nearby terrain, 0..1 where 1 is unoccluded. */
export const traceAmbientOcclusion = (
  ctx: RenderContext,
  px: number,
  py: number,
  pz: number,
  nx: number,
  ny: number,
  nz: number,
): number => {
  const { field, options } = ctx
  const samples = options.aoSamples
  if (!options.aoEnabled || samples <= 0) return 1

  let occlusion = 0
  for (let i = 1; i <= samples; i++) {
    const d = (options.aoRadius * i) / samples
    const sx = px + nx * d
    const sy = py + ny * d
    const sz = pz + nz * d
    const rise = heightAtExtended(field, sx, sz) - sy
    if (rise > 0) occlusion += clamp01(rise / (0.9 * d)) / samples
  }
  return clamp01(1 - occlusion * options.aoStrength)
}

const normalScratch = { x: 0, y: 0, z: 0 }
const albedoScratch: Rgb = { r: 0, g: 0, b: 0 }

/**
 * Fraction of direct sunlight reaching a point, including cloud shadows.
 * The cloud term is a cheap 2D lookup rather than a full volume march.
 */
const cloudShadowAt = (ctx: RenderContext, x: number, z: number, y: number): number => {
  const theme = ctx.world.theme
  const c = theme.cloud
  const strength = c.shadowStrength
  if (!ctx.cloudsEnabled || strength <= 0) return 1

  const scale = 1 / c.featureSize
  const ox = (x + c.wind.x * ctx.time * 40) * scale
  const oz = (z + c.wind.z * ctx.time * 40) * scale
  // Project the point up to the cloud base to find the column it sits under.
  const lift = Math.max(0, (c.baseAltitude - y) / Math.max(1, c.baseAltitude)) * 0.35
  const d = 0.5 + 0.5 * ctx.cloudShadowNoise.fbm(ox + lift, oz - lift, {
    octaves: 3,
    lacunarity: 2.1,
    gain: 0.55,
  })
  const threshold = 1 - c.coverage
  const cover = clamp01((d - threshold) / Math.max(0.02, 1 - threshold))
  return 1 - strength * cover
}

export interface SurfaceShade {
  r: number
  g: number
  b: number
}

/** Direct + ambient shading of the terrain surface, in linear light. */
export const shadeTerrain = (
  ctx: RenderContext,
  px: number,
  py: number,
  pz: number,
  dx: number,
  dy: number,
  dz: number,
  jitter: number,
  out: SurfaceShade,
): void => {
  const { field } = ctx
  normalAt(field, px, pz, normalScratch)

  const nx = normalScratch.x
  const ny = normalScratch.y
  const nz = normalScratch.z

  albedoAt(field, px, pz, albedoScratch)

  const ndl = nx * ctx.sunX + ny * ctx.sunY + nz * ctx.sunZ
  // Lift the shadow origin clear of the surface by about half a cell, or a
  // coarse heightfield will shadow itself.
  const bias = field.cell * 0.5 + 0.5
  const shadow = ndl > 0 ? traceShadow(ctx, px + nx * bias, py + bias, pz + nz * bias, jitter) : 0
  const cloudShade = cloudShadowAt(ctx, px, pz, py)

  const lightScale = Math.max(0, ndl) * shadow * cloudShade

  const occlusion = traceAmbientOcclusion(ctx, px, py, pz, nx, ny, nz)

  // Hemispheric ambient: sky above, bounced light below.
  const sky = 0.5 + 0.5 * ny
  const ambR = (ctx.skyAmbient.r * sky + ctx.groundAmbient.r * (1 - sky)) * occlusion
  const ambG = (ctx.skyAmbient.g * sky + ctx.groundAmbient.g * (1 - sky)) * occlusion
  const ambB = (ctx.skyAmbient.b * sky + ctx.groundAmbient.b * (1 - sky)) * occlusion

  const directR = ctx.sunRadiance.r * lightScale
  const directG = ctx.sunRadiance.g * lightScale
  const directB = ctx.sunRadiance.b * lightScale

  out.r = albedoScratch.r * (directR + ambR)
  out.g = albedoScratch.g * (directG + ambG)
  out.b = albedoScratch.b * (directB + ambB)
}
