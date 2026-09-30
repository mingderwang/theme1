/**
 * Tile rendering: the inner loop, shared by the inline path and the workers.
 *
 * A tile is a horizontal band of rows. Bands are independent, which is what
 * makes the parallel path produce byte identical output to the serial one.
 */

import { hash01 } from '../../core/rng/index.ts'
import type { Camera } from '../common/camera.ts'
import type { RenderContext } from './context.ts'
import { renderRay } from './shade.ts'
import { degToRad } from '../../core/math/index.ts'
import type { Vec3 } from '../../core/math/index.ts'

const dir: Vec3 = { x: 0, y: 0, z: 0 }

export interface TileRange {
  y0: number
  y1: number
}

/**
 * Render rows [y0, y1) into `out`, which holds linear RGB for that band only.
 * `out` is indexed as ((y - y0) * width + x) * 3.
 */
export const renderTileRows = (
  ctx: RenderContext,
  camera: Camera,
  width: number,
  height: number,
  y0: number,
  y1: number,
  out: Float32Array,
): void => {
  const theme = ctx.world.theme
  const r = theme.rendering
  const samples = Math.max(1, Math.round(r.supersampling))
  const sampleCount = samples * samples
  const invSamples = 1 / samples
  const tMax = r.maxDistance
  // Shadow penumbras are dithered by rotating the sun per pixel. Half the
  // authored softness is enough once the samples are averaged.
  const softnessRad = degToRad(theme.lighting.shadows.softness * 0.5)

  const ox = camera.position.x
  const oy = camera.position.y
  const oz = camera.position.z

  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < width; x++) {
      let ar = 0
      let ag = 0
      let ab = 0

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          // Sub pixel jitter. Derived from the pixel index so the pattern is
          // identical on every run and in every worker.
          const jx = hash01(x, y, sx * 2 + 1, 0x9e37)
          const jy = hash01(x, y, sx * 2, sy * 2 + 7, 0x85eb)
          const ndcX = ((x + (sx + jx) * invSamples) / width) * 2 - 1
          const ndcY = 1 - ((y + (sy + jy) * invSamples) / height) * 2

          camera.rayDir(ndcX, ndcY, dir)
          if (softnessRad > 0) {
            ctx.ditherAngle = softnessRad * (hash01(x, y, 0x2545f) * 2 - 1)
          }

          const result = renderRay(ctx, ox, oy, oz, dir.x, dir.y, dir.z, tMax, 0)
          ar += result.r
          ag += result.g
          ab += result.b
        }
      }

      const i = ((y - y0) * width + x) * 3
      out[i] = ar / sampleCount
      out[i + 1] = ag / sampleCount
      out[i + 2] = ab / sampleCount
    }
  }
}

/** Rows per tile. Small enough to keep workers busy, large enough to amortize. */
export const tileSize = (height: number, workers: number): number => {
  const target = Math.ceil(height / Math.max(1, workers * 3))
  return Math.max(8, Math.min(64, target))
}

export const buildTileRanges = (height: number, workers: number): TileRange[] => {
  const rows = tileSize(height, workers)
  const ranges: TileRange[] = []
  for (let y = 0; y < height; y += rows) {
    ranges.push({ y0: y, y1: Math.min(height, y + rows) })
  }
  return ranges
}
