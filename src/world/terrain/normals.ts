/**
 * Baked surface normals.
 *
 * A heightfield renderer can compute normals two ways: by finite differences
 * at render time, or by baking a normal map at generation time. The second
 * wins clearly. Finite differences taken from a bilinear heightfield are
 * piecewise constant per cell, so every cell edge shows as a facet; a baked
 * normal map, interpolated across the cell, shades smoothly and costs one
 * bilinear fetch at render time instead of four height fetches plus arithmetic.
 *
 * The trade is that the normal no longer matches the exact silhouette implied
 * by the height samples. At these cell sizes that difference is invisible,
 * while the faceting is not.
 */

import type { TerrainField } from '../types.ts'

/**
 * Fill `field.normals` from `field.heights`.
 * `stencil` is the finite difference width in cells: 1 tracks the geometry
 * closely, 2 gives a softer, more eroded look.
 */
export const bakeNormals = (field: TerrainField, stencil = 1): void => {
  const { stride, cell, heights, normals } = field
  const e = cell * stencil
  const inv = 1 / (2 * e)
  const last = stride - 1

  for (let z = 0; z < stride; z++) {
    const z0 = z > 0 ? z - 1 : 0
    const z1 = z < last ? z + 1 : last
    for (let x = 0; x < stride; x++) {
      const x0 = x > 0 ? x - 1 : 0
      const x1 = x < last ? x + 1 : last
      const h = heights[z * stride + x]!
      const hL = heights[z * stride + x0]!
      const hR = heights[z * stride + x1]!
      const hD = heights[z0 * stride + x]!
      const hU = heights[z1 * stride + x]!

      const nx = -(hR - hL) * inv
      const nz = -(hU - hD) * inv
      const len = Math.sqrt(nx * nx + 1 + nz * nz)
      const o = (z * stride + x) * 3
      normals[o] = nx / len
      normals[o + 1] = 1 / len
      normals[o + 2] = nz / len
    }
  }
}
