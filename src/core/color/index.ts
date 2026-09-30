/**
 * Color utilities.
 *
 * Convention: scene colors are linear. sRGB conversions happen when baking
 * textures to bytes and when writing the final image.
 */

import type { Rgb } from '../math/index.ts'
import { clamp01, lerp } from '../math/index.ts'

export const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

export const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055

export const hexToRgb = (hex: string): Rgb => {
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!
  const n = parseInt(h, 16)
  return {
    r: srgbToLinear(((n >> 16) & 255) / 255),
    g: srgbToLinear(((n >> 8) & 255) / 255),
    b: srgbToLinear((n & 255) / 255),
  }
}

export const rgbToHex = (c: Rgb): string => {
  const to = (v: number): string =>
    Math.round(clamp01(linearToSrgb(clamp01(v))) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(c.r)}${to(c.g)}${to(c.b)}`
}

/** Linear-space interpolation. */
export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => ({
  r: lerp(a.r, b.r, t),
  g: lerp(a.g, b.g, t),
  b: lerp(a.b, b.b, t),
})

export const scaleRgb = (a: Rgb, s: number): Rgb => ({ r: a.r * s, g: a.g * s, b: a.b * s })

export const luminance = (c: Rgb): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

// ---------------------------------------------------------------------------
// OKLab, used for stylistic grading where linear mixing goes muddy
// ---------------------------------------------------------------------------

export const rgbToOklab = (c: Rgb): Rgb => {
  const l = Math.cbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b)
  const m = Math.cbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b)
  const s = Math.cbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b)
  return {
    r: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    g: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

export const oklabToRgb = (c: Rgb): Rgb => {
  const l = c.r + 0.3963377774 * c.g + 0.2158037573 * c.b
  const m = c.r - 0.1055613458 * c.g - 0.0638541728 * c.b
  const s = c.r - 0.0894841775 * c.g - 1.291485548 * c.b
  const l3 = l * l * l
  const m3 = m * m * m
  const s3 = s * s * s
  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  }
}

/** Perceptually even blend. */
export const mixOklab = (a: Rgb, b: Rgb, t: number): Rgb => {
  const la = rgbToOklab(a)
  const lb = rgbToOklab(b)
  return oklabToRgb({
    r: lerp(la.r, lb.r, t),
    g: lerp(la.g, lb.g, t),
    b: lerp(la.b, lb.b, t),
  })
}

// ---------------------------------------------------------------------------
// Tone mapping
// ---------------------------------------------------------------------------

/** Narkowicz's fit of the ACES filmic curve. Cheap and reads as photographic. */
export const acesToneMap = (x: number): number => {
  const v = x < 0 ? 0 : x
  return clamp01((v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14))
}

export const reinhardToneMap = (x: number): number => {
  const a = 0.22
  const b = 0.30
  const c = 0.10
  const d = 0.20
  const e = 0.01
  const f = 0.30
  return clamp01(((x * (a * x + c * b) + d * e) / (x * (a * x + b) + d * f)) - e / f)
}

export type ToneMapping = 'aces' | 'reinhard' | 'linear'

export const toneMap = (x: number, mode: ToneMapping): number => {
  switch (mode) {
    case 'reinhard':
      return reinhardToneMap(x)
    case 'linear':
      return clamp01(x)
    default:
      return acesToneMap(x)
  }
}
