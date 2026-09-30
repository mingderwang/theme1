/**
 * Tone mapping and grading: the last step between the linear framebuffer and
 * the bytes in a PNG.
 */

import { clamp01 } from '../../core/math/index.ts'
import { linearToSrgb, srgbToLinear, toneMap, type ToneMapping } from '../../core/color/index.ts'
import { hexToRgb } from '../../core/color/index.ts'
import { hash01 } from '../../core/rng/index.ts'
import type { MonochromeTheme } from '../../theme/types.ts'

export interface PostSettings {
  width: number
  height: number
  exposure: number
  toneMapping: ToneMapping
  saturation: number
  vignette: number
  grain: number
  monochrome: MonochromeTheme
}

export const encodeByte = (linear: number): number => {
  const s = linearToSrgb(linear)
  return s <= 0 ? 0 : s >= 1 ? 255 : (s * 255 + 0.5) | 0
}

const sCurve = (x: number, contrast: number): number =>
  x < 0.5
    ? 0.5 * Math.pow(2 * x, contrast)
    : 1 - 0.5 * Math.pow(2 * (1 - x), contrast)

/**
 * Convert the linear framebuffer into sRGB bytes.
 * `grain` uses a hash of the pixel coordinate, so output is reproducible.
 */
export const present = (data: Float32Array, settings: PostSettings, out: Uint8Array): void => {
  const { width, height, exposure, toneMapping, saturation, vignette, grain } = settings
  const mono = settings.monochrome
  const monoOn = mono.enabled
  const tint = monoOn ? hexToRgb(mono.tint) : null
  const invHalfWidth = 2 / width
  const invHalfHeight = 2 / height

  for (let y = 0; y < height; y++) {
    const v = (y * invHalfHeight - 1) ** 2
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      let r = toneMap(data[i]! * exposure, toneMapping)
      let g = toneMap(data[i + 1]! * exposure, toneMapping)
      let b = toneMap(data[i + 2]! * exposure, toneMapping)

      if (saturation !== 1) {
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
        r = l + (r - l) * saturation
        g = l + (g - l) * saturation
        b = l + (b - l) * saturation
      }

      if (vignette > 0) {
        const u = x * invHalfWidth - 1
        const d2 = u * u + v
        const falloff = 1 - vignette * clamp01(d2) ** 1.4
        r *= falloff
        g *= falloff
        b *= falloff
      }

      if (grain > 0) {
        // Grain is stronger in the mid tones, as film is.
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
        const n = (hash01(x, y, 0x5bf03635) - 0.5) * grain * (0.25 + 0.75 * (1 - Math.abs(l * 2 - 1)))
        r += n
        g += n
        b += n
      }

      if (monoOn && tint) {
        // Grade in a perceptual space, then return to linear so the rest of
        // the pipeline still sees linear light.
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
        const s = clamp01(sCurve(linearToSrgb(l), mono.contrast) + mono.lift) * mono.gain
        const lin = srgbToLinear(s)
        r = lin * tint.r
        g = lin * tint.g
        b = lin * tint.b
      }

      out[i] = (clamp01(r) * 255 + 0.5) | 0
      out[i + 1] = (clamp01(g) * 255 + 0.5) | 0
      out[i + 2] = (clamp01(b) * 255 + 0.5) | 0
    }
  }
}
