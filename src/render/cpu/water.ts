/**
 * Water.
 *
 * The surface is a plane at the resolved water level with normals from two
 * layers of the seeded noise field. Shading is Fresnel weighted: a reflected
 * ray towards the scene, a refracted ray towards the bottom, Beer-Lambert
 * extinction over the water column, a sun glint and foam in the shallows.
 */

import { clamp01, smoothstep } from '../../core/math/index.ts'
import type { Rgb, Vec3 } from '../../core/math/index.ts'
import { heightAtExtended, albedoAt } from '../../world/terrain/sample.ts'
import type { RenderContext } from './context.ts'
import type { SurfaceShade } from './terrain.ts'

/** Distance along the ray to the water plane, or -1. */
export const waterPlaneHit = (ctx: RenderContext, oy: number, dy: number, tMax: number): number => {
  if (!ctx.waterEnabled) return -1
  if (dy >= -1e-6) return -1
  const t = (ctx.waterLevel - oy) / dy
  return t > 0 && t < tMax ? t : -1
}

/** Surface normal from the gradient of two scrolling noise fields. */
export const waterNormal = (ctx: RenderContext, x: number, y: number, z: number, out: Vec3): void => {
  const theme = ctx.world.theme.water
  const noise = ctx.waveNoise
  const t = ctx.time * theme.waveSpeed

  const s1 = 0.9 * theme.waveScale
  const s2 = 3.7 * theme.waveScale
  const amp1 = 0.09
  const amp2 = 0.028 * theme.waveDetail

  const e = 1.4
  // Two directional wave trains plus a noise field for chop.
  const wave =
    (x: number, z: number): number =>
      amp1 * Math.sin((x * 0.75 + z * 0.35) * s1 + t * 6) +
      amp1 * 0.6 * Math.sin((x * -0.4 + z * 0.9) * s1 * 1.7 + t * 4.4) +
      amp2 * noise.fbm(x * 0.035 + t * 2, z * 0.035 - t * 1.3, {
        octaves: 3,
        lacunarity: 2.1,
        gain: 0.5,
      })

  const dx = (wave(x + e, z) - wave(x - e, z)) / (2 * e)
  const dz = (wave(x, z + e) - wave(x, z - e)) / (2 * e)

  // The waves flatten out in the shallows, and are faded out with distance.
  // The distance fade is not optional: a full amplitude wave field a few
  // kilometres away is far below one pixel and turns into shimmering speckle.
  const depth = ctx.waterLevel - heightAtExtended(ctx.field, x, z)
  const shallowFade = smoothstep(0, 3, depth)
  const viewDistance = Math.hypot(x - ctx.viewX, y - ctx.viewY, z - ctx.viewZ)
  const distanceFade = 1 - smoothstep(300, 2200, viewDistance)

  const scale = shallowFade * distanceFade
  const nx = -dx * scale
  const nz = -dz * scale

  const len = Math.sqrt(nx * nx + 1 + nz * nz)
  out.x = nx / len
  out.y = 1 / len
  out.z = nz / len
}

const F0_WATER = 0.02

const normalScratch: Vec3 = { x: 0, y: 1, z: 0 }
const bottomAlbedo: Rgb = { r: 0, g: 0, b: 0 }
const reflected: Rgb = { r: 0, g: 0, b: 0 }
const refracted: Rgb = { r: 0, g: 0, b: 0 }
const skyScratch: Rgb = { r: 0, g: 0, b: 0 }

export interface WaterShadeOptions {
  /** Called for the reflected and refracted rays. */
  traceBackground: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tMax: number) => void
  traceShadow: (ox: number, oy: number, oz: number) => number
}

/** Schlick's approximation of the Fresnel reflectance. */
const fresnel = (cosTheta: number, power: number): number => {
  const m = 1 - clamp01(cosTheta)
  return F0_WATER + (1 - F0_WATER) * Math.pow(m, Math.max(1, power))
}

export const shadeWater = (
  ctx: RenderContext,
  px: number,
  py: number,
  pz: number,
  dx: number,
  dy: number,
  dz: number,
  options: WaterShadeOptions,
  out: SurfaceShade,
): void => {
  const theme = ctx.world.theme.water
  waterNormal(ctx, px, py, pz, normalScratch)
  const nx = normalScratch.x
  const ny = normalScratch.y
  const nz = normalScratch.z

  const cosTheta = -(dx * nx + dy * ny + dz * nz)
  const reflectAmount = fresnel(cosTheta, theme.fresnelPower) * theme.reflectivity

  // --- reflection -------------------------------------------------------
  const rdotn = dx * nx + dy * ny + dz * nz
  const rx = dx - 2 * rdotn * nx
  const ry = dy - 2 * rdotn * ny
  const rz = dz - 2 * rdotn * nz

  if (theme.reflections && ctx.options.waterReflections) {
    options.traceBackground(px + nx * 0.5, py + ny * 0.5, pz + nz * 0.5, rx, ry, rz, ctx.options.maxDistance)
    reflected.r = skyScratch.r
    reflected.g = skyScratch.g
    reflected.b = skyScratch.b
  } else {
    reflected.r = ctx.skyHorizon.r
    reflected.g = ctx.skyHorizon.g
    reflected.b = ctx.skyHorizon.b
  }

  // --- refraction and the water column ---------------------------------
  const ior = Math.max(1.0001, theme.ior)
  const eta = 1 / ior
  const cosi = -(dx * nx + dy * ny + dz * nz)
  const k = 1 - eta * eta * (1 - cosi * cosi)
  const totalInternal = k < 0

  const bottom = heightAtExtended(ctx.field, px, pz)
  const depth = Math.max(0, ctx.waterLevel - bottom)
  const pathScale = 1 / Math.max(0.25, cosi)

  if (!totalInternal) {
    const tx = eta * dx + (eta * cosi - Math.sqrt(k)) * nx
    const ty = eta * dy + (eta * cosi - Math.sqrt(k)) * ny
    const tz = eta * dz + (eta * cosi - Math.sqrt(k)) * nz
    const tl = Math.hypot(tx, ty, tz)

    if (theme.reflections && ctx.options.waterReflections) {
      options.traceBackground(
        px - nx * 0.5,
        ctx.waterLevel - 0.5,
        pz - nz * 0.5,
        tx / tl,
        ty / tl,
        tz / tl,
        Math.max(40, depth * 3 + 60),
      )
      refracted.r = skyScratch.r
      refracted.g = skyScratch.g
      refracted.b = skyScratch.b
    } else {
      refracted.r = 0
      refracted.g = 0
      refracted.b = 0
    }
  } else {
    reflected.r = skyScratch.r
    reflected.g = skyScratch.g
    reflected.b = skyScratch.b
  }

  // Beer-Lambert extinction through the column.
  const pathLength = depth * pathScale
  const transmit = Math.exp(-theme.turbidity * pathLength)
  const floorTurbidity = theme.turbidity * 0.35

  albedoAt(ctx.field, px, pz, bottomAlbedo)

  // Suspended sediment scatters light back; that is what makes shallow
  // tropical water turquoise rather than clear.
  const scatterAmount = (1 - Math.exp(-floorTurbidity * pathLength)) * (1 - transmit)
  const floorLight =
    (bottomAlbedo.r * (ctx.skyAmbient.r * 0.5 + ctx.sunRadiance.r * 0.32 * Math.max(0, ctx.sunY)) +
      refracted.r * 0.5) *
    0.5
  const floorLightG =
    (bottomAlbedo.g * (ctx.skyAmbient.g * 0.5 + ctx.sunRadiance.g * 0.32 * Math.max(0, ctx.sunY)) +
      refracted.g * 0.5) *
    0.5
  const floorLightB =
    (bottomAlbedo.b * (ctx.skyAmbient.b * 0.5 + ctx.sunRadiance.b * 0.32 * Math.max(0, ctx.sunY)) +
      refracted.b * 0.5) *
    0.5

  const deepMix = smoothstep(0, 1, Math.exp(-depth / Math.max(0.5, theme.depthFade)))
  const bodyR = ctx.waterDeep.r * (0.35 + 0.65 * deepMix)
  const bodyG = ctx.waterDeep.g * (0.35 + 0.65 * deepMix)
  const bodyB = ctx.waterDeep.b * (0.35 + 0.65 * deepMix)

  const underR = bodyR + (floorLight + refracted.r * 0.35) * transmit * 0.7 + ctx.waterShallow.r * scatterAmount * 0.5
  const underG = bodyG + (floorLightG + refracted.g * 0.35) * transmit * 0.7 + ctx.waterShallow.g * scatterAmount * 0.5
  const underB = bodyB + (floorLightB + refracted.b * 0.35) * transmit * 0.7 + ctx.waterShallow.b * scatterAmount * 0.5

  let r = underR * (1 - reflectAmount) + reflected.r * reflectAmount
  let g = underG * (1 - reflectAmount) + reflected.g * reflectAmount
  let b = underB * (1 - reflectAmount) + reflected.b * reflectAmount

  // --- sun glint --------------------------------------------------------
  // Roughen with distance: a mirror sharp highlight on a wave field that is
  // smaller than a pixel is pure aliasing, so the lobe widens and dims as the
  // surface recedes.
  const viewDistance = Math.hypot(px - ctx.viewX, py - ctx.viewY, pz - ctx.viewZ)
  const glintFalloff = 1 / (1 + viewDistance / 500)
  const shadow = options.traceShadow(px, py, pz)
  const hx = ctx.sunX - dx
  const hy = ctx.sunY - dy
  const hz = ctx.sunZ - dz
  const hl = Math.hypot(hx, hy, hz) || 1
  const nh = (nx * hx + ny * hy + nz * hz) / hl
  if (nh > 0) {
    const sharpness = 40 + 860 * glintFalloff
    const spec =
      (Math.pow(nh, sharpness) * 2.4 * glintFalloff + Math.pow(nh, 24) * 0.1) * shadow
    r += ctx.sunRadiance.r * spec
    g += ctx.sunRadiance.g * spec
    b += ctx.sunRadiance.b * spec
  }

  // --- foam -------------------------------------------------------------
  if (theme.foamDepth > 0) {
    const foam = smoothstep(theme.foamDepth, 0, depth)
    if (foam > 0) {
      const chop = 0.6 + 0.4 * ctx.waveNoise.fbm(px * 0.09, pz * 0.09, {
        octaves: 3,
        lacunarity: 2.1,
        gain: 0.5,
      })
      const f = foam * chop
      r += (ctx.foamColor.r - r) * f * 0.85
      g += (ctx.foamColor.g - g) * f * 0.85
      b += (ctx.foamColor.b - b) * f * 0.85
    }
  }

  out.r = r
  out.g = g
  out.b = b
}
