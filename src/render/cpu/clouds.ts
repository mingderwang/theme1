/**
 * Volumetric clouds.
 *
 * A slab between the base and top altitudes, marched front to back with an
 * extinction medium (Beer-Lambert), a Henyey-Greenstein phase function for
 * forward scattering, and a short march towards the sun at every occupied
 * sample to get self shadowing.
 *
 * Cost control matters here: samples with no density skip both the erosion
 * octaves and the light march, and the step size grows with distance.
 */

import { clamp01, smoothstep } from '../../core/math/index.ts'
import type { Rgb } from '../../core/math/index.ts'
import type { RenderContext } from './context.ts'

const FOUR_PI = 4 * Math.PI

/** Henyey-Greenstein phase, normalized so isotropic scattering equals 1. */
export const phaseHG = (cosTheta: number, g: number): number => {
  const g2 = g * g
  const denom = 1 + g2 - 2 * g * cosTheta
  if (denom <= 1e-4) return 0
  return ((1 - g2) / (4 * Math.PI * Math.pow(denom, 1.5))) * FOUR_PI
}

/** Extinction of the cloud medium at a point, 0 means clear air. */
export const cloudDensity = (ctx: RenderContext, x: number, y: number, z: number): number => {
  const theme = ctx.world.theme.cloud
  const scale = 1 / Math.max(1, theme.featureSize)

  const driftX = theme.wind.x * ctx.time * 12
  const driftZ = theme.wind.z * ctx.time * 12
  const qx = (x + driftX) * scale
  const qy = y * scale * 2.2
  const qz = (z + driftZ) * scale

  let base = clamp01(
    0.5 + 0.5 * ctx.cloudNoise.fbm(qx, qy, qz, {
      octaves: theme.octaves,
      lacunarity: 2.07,
      gain: 0.52,
    }),
  )

  if (theme.billow > 0) {
    // Puffy cauliflower bases rather than flat stratus.
    const billow = clamp01(
      0.5 + 0.5 * ctx.cloudErosionNoise.fbm(qx * 0.7 + 3.1, qy * 0.7, qz * 0.7 - 1.4, {
        octaves: 2,
        lacunarity: 2.1,
        gain: 0.5,
      }),
    )
    base = base * (1 - theme.billow) + billow * theme.billow
  }

  const threshold = 1 - clamp01(theme.coverage)
  let d = (base - threshold) / Math.max(0.02, 1 - threshold)
  if (d <= 0) return 0
  d *= theme.density

  // Vertical profile: flat bottom, rounded top.
  const h = clamp01((y - theme.baseAltitude) / Math.max(1, theme.topAltitude - theme.baseAltitude))
  const profile = smoothstep(0, 0.14, h) * (1 - smoothstep(0.62, 1, h))
  d *= profile
  if (d <= 0) return 0

  if (theme.erosionOctaves > 0) {
    const e = clamp01(
      0.5 +
        0.5 *
          ctx.cloudErosionNoise.fbm(qx * 3.4, qy * 3.4, qz * 3.4, {
            octaves: theme.erosionOctaves,
            lacunarity: 2.13,
            gain: 0.55,
          }),
    )
    // Subtractive erosion: bite chunks out of the edges of the medium.
    const bite = e * 0.45
    d = (d - bite) / Math.max(0.05, 1 - bite)
  }

  return d > 0 ? d : 0
}

/** Extinction per meter per unit density. */
const EXTINCTION = 0.0016

/** Optical depth from a point towards the sun, converted to transmittance. */
const lightTransmittance = (ctx: RenderContext, x: number, y: number, z: number): number => {
  const theme = ctx.world.theme.cloud
  const steps = Math.max(1, ctx.options.cloudLightSteps)
  const span = theme.featureSize * 0.12
  const dx = ctx.sunX
  const dy = ctx.sunY
  const dz = ctx.sunZ

  let t = 0
  let optical = 0
  const invSteps = 1 / steps
  for (let i = 0; i < steps; i++) {
    // Quadratic step distribution: dense near the point, sparse far away.
    const f0 = i * invSteps
    const f1 = (i + 1) * invSteps
    const dt = span * (f1 * f1 - f0 * f0)
    const tMid = t + dt * 0.5
    const d = cloudDensity(ctx, x + dx * tMid, y + dy * tMid, z + dz * tMid)
    if (d > 0) optical += d * dt
    t += dt
  }
  return Math.exp(-optical * EXTINCTION)
}

export interface CloudResult {
  color: Rgb
  /** 1 where the cloud is fully opaque. */
  alpha: number
}

const cloudColorScratch: Rgb = { r: 0, g: 0, b: 0 }

/**
 * Composite the cloud layer over `over`, which already holds whatever the ray
 * hit. The march stops at the surface distance so terrain in front of the
 * clouds stays in front of them.
 */
export const marchClouds = (
  ctx: RenderContext,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tSurface: number,
  over: Rgb,
): void => {
  if (!ctx.cloudsEnabled) return

  const theme = ctx.world.theme.cloud
  const base = ctx.cloudBase
  const top = ctx.cloudTop

  let t0: number
  let t1: number
  if (Math.abs(dy) < 1e-6) return
  const ta = (base - oy) / dy
  const tb = (top - oy) / dy
  t0 = Math.min(ta, tb)
  t1 = Math.max(ta, tb)

  if (t0 < 0) t0 = 0
  if (t1 > tSurface) t1 = tSurface
  if (t1 <= t0) return

  const steps = Math.max(2, ctx.options.cloudSteps)
  const span = t1 - t0
  let t = 0

  const sunDot = dx * ctx.sunX + dy * ctx.sunY + dz * ctx.sunZ
  const phase = phaseHG(sunDot, theme.anisotropy)
  const backPhase = phaseHG(sunDot, -theme.anisotropy * 0.6)
  const twoSided = Math.max(phase, backPhase * 0.5)

  let transmittance = 1
  cloudColorScratch.r = 0
  cloudColorScratch.g = 0
  cloudColorScratch.b = 0

  const ambient = ctx.ambientTotal
  const lit = ctx.cloudLit
  const shadowTint = ctx.cloudShadow

  for (let i = 0; i < steps; i++) {
    // Quadratic step distribution: fine near the camera, coarse far away, so
    // the budget goes where the cloud is largest on screen.
    const f0 = i / steps
    const f1 = (i + 1) / steps
    const dt = span * (f1 * f1 - f0 * f0)
    const tMid = t + dt * 0.5

    const px = ox + dx * tMid
    const py = oy + dy * tMid
    const pz = oz + dz * tMid

    const density = cloudDensity(ctx, px, py, pz)
    if (density <= 0) {
      t += dt
      continue
    }

    const alpha = 1 - Math.exp(-density * dt * EXTINCTION)
    if (alpha > 0.0005) {
      const lt = lightTransmittance(ctx, px, py, pz)

      // Direct sunlight scattered into the view, plus the ambient sky term.
      const direct = lt * twoSided * 0.9
      const inR = lit.r * ctx.sunRadiance.r * direct + shadowTint.r * ambient.r * 0.55
      const inG = lit.g * ctx.sunRadiance.g * direct + shadowTint.g * ambient.g * 0.55
      const inB = lit.b * ctx.sunRadiance.b * direct + shadowTint.b * ambient.b * 0.55

      const weight = transmittance * alpha
      cloudColorScratch.r += inR * weight
      cloudColorScratch.g += inG * weight
      cloudColorScratch.b += inB * weight
      transmittance *= 1 - alpha

      if (transmittance < 0.008) break
    }
    t += dt
  }

  if (transmittance >= 0.999) return

  over.r = over.r * transmittance + cloudColorScratch.r
  over.g = over.g * transmittance + cloudColorScratch.g
  over.b = over.b * transmittance + cloudColorScratch.b
}
