/**
 * Aerial perspective.
 *
 * Height based fog with a directional in-scatter term. This is what makes
 * distance read as distance; without it a 12km view looks like a 200m view.
 */

import { clamp01, smoothstep } from '../../core/math/index.ts'
import type { Rgb } from '../../core/math/index.ts'
import type { RenderContext } from './context.ts'

const FOG_BASE = 200

export const fogFactor = (
  ctx: RenderContext,
  distance: number,
  y: number,
): number => {
  const atmosphere = ctx.world.theme.atmosphere
  if (atmosphere.fogDensity <= 0) return 0
  const reference = ctx.waterEnabled ? ctx.waterLevel : FOG_BASE
  // Fog thins with altitude; integrate the exponential along the ray cheaply by
  // evaluating it at the midpoint of the segment.
  const midY = y * 0.5
  const heightFalloff = Math.exp(-Math.max(0, midY - reference) / Math.max(1, atmosphere.fogHeight))
  const opticalDepth = distance * atmosphere.fogDensity * heightFalloff * atmosphere.haze
  return clamp01(1 - Math.exp(-opticalDepth))
}

export const applyAerial = (
  ctx: RenderContext,
  color: Rgb,
  distance: number,
  y: number,
  dx: number,
  dy: number,
  dz: number,
): void => {
  const atmosphere = ctx.world.theme.atmosphere
  const amount = fogFactor(ctx, distance, y)
  if (amount <= 0) return

  const sunDot = dx * ctx.sunX + dy * ctx.sunY + dz * ctx.sunZ
  const towardsSun = Math.max(0, sunDot) ** 4 * atmosphere.sunScatter
  const scatter = Math.min(1, towardsSun)

  const fr = ctx.fogColor.r + (ctx.sunFogColor.r - ctx.fogColor.r) * scatter
  const fg = ctx.fogColor.g + (ctx.sunFogColor.g - ctx.fogColor.g) * scatter
  const fb = ctx.fogColor.b + (ctx.sunFogColor.b - ctx.fogColor.b) * scatter

  const a = amount * atmosphere.scattering
  color.r += (fr - color.r) * a
  color.g += (fg - color.g) * a
  color.b += (fb - color.b) * a
}

/** Extra haze near the horizon for rays that never hit anything. */
export const applySkyHaze = (ctx: RenderContext, color: Rgb, dy: number): void => {
  const atmosphere = ctx.world.theme.atmosphere
  if (atmosphere.haze <= 0) return
  const amount = smoothstep(0.35, -0.02, dy) * 0.45 * atmosphere.haze * atmosphere.scattering
  if (amount <= 0) return
  color.r += (ctx.fogColor.r - color.r) * amount
  color.g += (ctx.fogColor.g - color.g) * amount
  color.b += (ctx.fogColor.b - color.b) * amount
}
