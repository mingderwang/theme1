/**
 * Thermal erosion.
 *
 * Material steeper than the talus angle slides to its lower neighbours, which
 * is enough to stop the raw noise from producing vertical spikes and to build
 * scree at the foot of cliffs. Deliberately not hydraulic erosion: the basic
 * terrain pipeline has to stay predictable.
 *
 * The pass is fully deterministic: fixed iteration order, no randomisation.
 */

import { degToRad } from '../../core/math/index.ts'
import type { ErosionTheme } from '../../theme/types.ts'

export const thermalErode = (
  heights: Float32Array,
  resolution: number,
  cell: number,
  options: ErosionTheme,
): void => {
  if (!options.enabled || options.iterations <= 0) return

  const stride = resolution + 1
  const maxDrop = Math.tan(degToRad(options.talusAngle)) * cell
  const rate = Math.min(0.9, Math.max(0, options.rate))
  const diffusion = Math.min(0.5, Math.max(0, options.diffusion))
  const delta = new Float32Array(heights.length)
  const neighborSum = new Float32Array(heights.length)

  for (let iteration = 0; iteration < options.iterations; iteration++) {
    delta.fill(0)
    neighborSum.fill(0)

    for (let z = 1; z < stride - 1; z++) {
      const row = z * stride
      for (let x = 1; x < stride - 1; x++) {
        const i = row + x
        const h = heights[i]!

        const iL = i - 1
        const iR = i + 1
        const iD = i - stride
        const iU = i + stride

        const sum = heights[iL]! + heights[iR]! + heights[iD]! + heights[iU]!
        neighborSum[i] = sum

        const hL = heights[iL]!
        const hR = heights[iR]!
        const hD = heights[iD]!
        const hU = heights[iU]!

        if (h - hL > maxDrop) {
          const move = rate * (h - hL - maxDrop) * 0.5
          delta[i] = delta[i]! - move
          delta[iL] = delta[iL]! + move
        }
        if (h - hR > maxDrop) {
          const move = rate * (h - hR - maxDrop) * 0.5
          delta[i] = delta[i]! - move
          delta[iR] = delta[iR]! + move
        }
        if (h - hD > maxDrop) {
          const move = rate * (h - hD - maxDrop) * 0.5
          delta[i] = delta[i]! - move
          delta[iD] = delta[iD]! + move
        }
        if (h - hU > maxDrop) {
          const move = rate * (h - hU - maxDrop) * 0.5
          delta[i] = delta[i]! - move
          delta[iU] = delta[iU]! + move
        }
      }
    }

    for (let z = 1; z < stride - 1; z++) {
      const row = z * stride
      for (let x = 1; x < stride - 1; x++) {
        const i = row + x
        const average = neighborSum[i]! * 0.25
        heights[i] = heights[i]! + delta[i]! + diffusion * (average - heights[i]!)
      }
    }
  }
}

/**
 * Fill any remaining holes so a ray can never fall through a single bad cell.
 * Cheap insurance: without it a NaN or spike from a future generator would
 * show up as a black hole in the final image.
 */
export const sanitizeHeights = (heights: Float32Array, fallback: number): void => {
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i]!
    if (!Number.isFinite(h)) heights[i] = fallback
  }
}
