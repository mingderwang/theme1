/**
 * Analytic sky.
 *
 * A full Preetham or Hosek model is more physical than this, but the theme
 * wants direct control over the zenith, the horizon and the sun's glow, so
 * this is a hand built model: a two colour vertical gradient plus Mie-like
 * forward scattering lobes and a sun disc.
 */

import { clamp01, smoothstep } from '../../core/math/index.ts'
import { hash01 } from '../../core/rng/index.ts'
import type { Rgb } from '../../core/math/index.ts'
import type { RenderContext } from './context.ts'

export const skyRadiance = (
  ctx: RenderContext,
  dx: number,
  dy: number,
  dz: number,
  out: Rgb,
): void => {
  const sky = ctx.world.theme.sky
  const up = clamp01(dy)

  // Vertical gradient: pow keeps the horizon tight, like a real sky.
  const t = (1 - up) ** 4
  let r = ctx.skyZenith.r + (ctx.skyHorizon.r - ctx.skyZenith.r) * t
  let g = ctx.skyZenith.g + (ctx.skyHorizon.g - ctx.skyZenith.g) * t
  let b = ctx.skyZenith.b + (ctx.skyHorizon.b - ctx.skyZenith.b) * t

  const sunDot = dx * ctx.sunX + dy * ctx.sunY + dz * ctx.sunZ

  if (sunDot > 0) {
    const s = sunDot
    // Broad scattering: the whole sky brightens towards the sun.
    const wide = s ** 2.2 * sky.turbidity * 0.5
    // Tight Mie lobe around the disc.
    const mie = s ** 24 * sky.mie * 0.8
    const glow = (wide + mie) * sky.sunGlow
    r += ctx.sunGlowColor.r * glow
    g += ctx.sunGlowColor.g * glow
    b += ctx.sunGlowColor.b * glow

    // Sun disc with a soft limb.
    const angle = Math.acos(s > 1 ? 1 : s)
    const disc = 1 - smoothstep(ctx.sunAngularRadius * 0.82, ctx.sunAngularRadius, angle)
    if (disc > 0) {
      r += ctx.sunDiscColor.r * disc
      g += ctx.sunDiscColor.g * disc
      b += ctx.sunDiscColor.b * disc
    }
  }

  if (dy < 0) {
    // Below the horizon: the ground haze that a reflected ray can pick up.
    const g2 = smoothstep(0, -0.14, dy)
    r += (ctx.skyGround.r - r) * g2
    g += (ctx.skyGround.g - g) * g2
    b += (ctx.skyGround.b - b) * g2
  }

  if (sky.stars > 0 && dy > -0.02) {
    // Hash the direction into cells, then pick one point per cell.
    const u = dx * 220
    const v = dy * 220
    const w = dz * 220
    const cx = Math.floor(u)
    const cy = Math.floor(v)
    const cz = Math.floor(w)
    const h = hash01(cx, cy, cz, 0x2f1b)
    if (h > 0.9955) {
      const brightness = (h - 0.9955) / 0.0045
      const fade = clamp01(dy * 3)
      const twinkle = 0.7 + 0.3 * hash01(cx, cy, cz, 0x77)
      const s = brightness * brightness * fade * twinkle * sky.stars
      r += s
      g += s
      b += s * 1.05
    }
  }

  out.r = r
  out.g = g
  out.b = b
}
