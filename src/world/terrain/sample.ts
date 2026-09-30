/**
 * Sampling a TerrainField.
 *
 * These functions are the hot path of the CPU renderer: they run millions of
 * times per image, so they are plain functions over typed arrays, bilinear,
 * and free of allocation.
 */

import type { TerrainField } from '../types.ts'

/**
 * Clamp a world coordinate to a safe grid coordinate.
 *
 * The upper limit is `stride - 1.0001`, not `stride - 1`: a bilinear tap reads
 * the cell plus its +1 neighbour, so allowing exactly `stride - 1` would read
 * one past the end of the array. JavaScript returns `undefined` there rather
 * than throwing, which turns into a silent NaN at the tile border instead of
 * an obvious crash.
 */
const gridCoord = (value: number, stride: number): number => {
  const max = stride - 1.0001
  return value < 0 ? 0 : value > max ? max : value
}

/**
 * Quintic interpolation weight.
 *
 * Plain bilinear has a derivative discontinuity at every cell boundary, which
 * shows up as grid aligned creases on silhouettes and in normals. Weighting
 * the interpolation with this fade makes the sampled surface C1 continuous,
 * because the weight's derivative is zero at both ends. Four extra multiplies
 * buys the whole problem.
 */
const quintic = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)

/** Bilinear height lookup with C1 continuous weights. Coordinates are clamped. */
export const heightAt = (field: TerrainField, x: number, z: number): number => {
  const { stride, cell, heights } = field
  const cx = gridCoord((x + field.size * 0.5) / cell, stride)
  const cz = gridCoord((z + field.size * 0.5) / cell, stride)
  const x0 = cx | 0
  const z0 = cz | 0
  const wx = quintic(cx - x0)
  const wz = quintic(cz - z0)

  const i00 = z0 * stride + x0
  const h00 = heights[i00]!
  const h10 = heights[i00 + 1]!
  const h01 = heights[i00 + stride]!
  const h11 = heights[i00 + stride + 1]!

  const top = h00 + (h10 - h00) * wx
  const bottom = h01 + (h11 - h01) * wx
  return top + (bottom - top) * wz
}

/** Height lookup that extends the tile with `voidHeight` instead of clamping.
 *  Used while marching so a ray can leave the tile and still find a surface. */
export const heightAtExtended = (field: TerrainField, x: number, z: number): number => {
  const half = field.size * 0.5
  if (x < -half || x > half || z < -half || z > half) return field.voidHeight
  return heightAt(field, x, z)
}

export const contains = (field: TerrainField, x: number, z: number): boolean => {
  const half = field.size * 0.5
  return x >= -half && x <= half && z >= -half && z <= half
}

export const gradientAt = (
  field: TerrainField,
  x: number,
  z: number,
  out: { x: number; z: number },
): void => {
  const e = field.cell
  const hx = heightAt(field, x + e, z) - heightAt(field, x - e, z)
  const hz = heightAt(field, x, z + e) - heightAt(field, x, z - e)
  out.x = hx / (2 * e)
  out.z = hz / (2 * e)
}

/**
 * Surface normal from the baked normal map, interpolated across the cell and
 * renormalized. Writes x,y,z with y up.
 */
export const normalAt = (
  field: TerrainField,
  x: number,
  z: number,
  out: { x: number; y: number; z: number },
): void => {
  const half = field.size * 0.5
  if (x < -half || x > half || z < -half || z > half) {
    out.x = 0
    out.y = 1
    out.z = 0
    return
  }
  const { stride, cell, normals } = field
  const cx = gridCoord((x + half) / cell, stride)
  const cz = gridCoord((z + half) / cell, stride)
  const x0 = cx | 0
  const z0 = cz | 0
  const fx = cx - x0
  const fz = cz - z0

  const i00 = (z0 * stride + x0) * 3
  const i10 = i00 + 3
  const i01 = i00 + stride * 3
  const i11 = i01 + 3

  const ax = normals[i00]! + (normals[i10]! - normals[i00]!) * fx
  const ay = normals[i00 + 1]! + (normals[i10 + 1]! - normals[i00 + 1]!) * fx
  const az = normals[i00 + 2]! + (normals[i10 + 2]! - normals[i00 + 2]!) * fx
  const bx = normals[i01]! + (normals[i11]! - normals[i01]!) * fx
  const by = normals[i01 + 1]! + (normals[i11 + 1]! - normals[i01 + 1]!) * fx
  const bz = normals[i01 + 2]! + (normals[i11 + 2]! - normals[i01 + 2]!) * fx

  const nx = ax + (bx - ax) * fz
  const ny = ay + (by - ay) * fz
  const nz = az + (bz - az) * fz

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
  out.x = nx / len
  out.y = ny / len
  out.z = nz / len
}

/**
 * Surface albedo, bilinearly interpolated and converted from the baked sRGB
 * bytes to linear light. Nearest cell lookup here would quantize the whole
 * image to the heightfield grid.
 */
export const albedoAt = (
  field: TerrainField,
  x: number,
  z: number,
  out: { r: number; g: number; b: number },
): void => {
  const half = field.size * 0.5
  if (x < -half || x > half || z < -half || z > half) {
    out.r = 0
    out.g = 0
    out.b = 0
    return
  }
  const { stride, cell, albedo } = field
  // Same clamped grid coordinate as the height lookup, so the +1 neighbour is
  // always in bounds and the albedo never quantizes to the grid.
  const cx = gridCoord((x + half) / cell, stride)
  const cz = gridCoord((z + half) / cell, stride)
  const x0 = cx | 0
  const z0 = cz | 0
  const fx = cx - x0
  const fz = cz - z0

  const i00 = (z0 * stride + x0) * 3
  const i10 = i00 + 3
  const i01 = i00 + stride * 3
  const i11 = i01 + 3

  const ar = albedo[i00]!
  const ag = albedo[i00 + 1]!
  const ab = albedo[i00 + 2]!
  const br = albedo[i10]!
  const bg = albedo[i10 + 1]!
  const bb = albedo[i10 + 2]!
  const cr = albedo[i01]!
  const cg = albedo[i01 + 1]!
  const cb = albedo[i01 + 2]!
  const dr = albedo[i11]!
  const dg = albedo[i11 + 1]!
  const db = albedo[i11 + 2]!

  const w00 = (1 - fx) * (1 - fz)
  const w10 = fx * (1 - fz)
  const w01 = (1 - fx) * fz
  const w11 = fx * fz

  out.r = LUT[(ar * w00 + br * w10 + cr * w01 + dr * w11 + 0.5) | 0]!
  out.g = LUT[(ag * w00 + bg * w10 + cg * w01 + dg * w11 + 0.5) | 0]!
  out.b = LUT[(ab * w00 + bb * w10 + cb * w01 + db * w11 + 0.5) | 0]!
}

/** sRGB byte to linear, so the albedo fetch needs no per pixel pow(). */
const LUT = ((): Float32Array => {
  const table = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const c = i / 255
    table[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return table
})()

export const linearToSrgbByte = (c: number): number => {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c < 0 ? 0 : c, 1 / 2.4) - 0.055
  return v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0
}

const SRGB_TO_LINEAR_LUT = buildSrgbToLinearLut()

export const srgbByteToLinear = (byte: number): number => SRGB_TO_LINEAR_LUT[byte]!

function buildSrgbToLinearLut(): Float32Array {
  const lut = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const c = i / 255
    lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return lut
}

export const moistureAt = (field: TerrainField, x: number, z: number): number =>
  bilinearScalar(field.moisture, field, x, z)

export const temperatureAt = (field: TerrainField, x: number, z: number): number =>
  bilinearScalar(field.temperature, field, x, z)

export const slopeAt = (field: TerrainField, x: number, z: number): number =>
  bilinearScalar(field.slope, field, x, z)

export const bilinearScalar = (
  data: Float32Array,
  field: TerrainField,
  x: number,
  z: number,
): number => {
  const half = field.size * 0.5
  if (x < -half || x > half || z < -half || z > half) return 0
  const { stride, cell } = field
  const cx = gridCoord((x + half) / cell, stride)
  const cz = gridCoord((z + half) / cell, stride)
  const x0 = cx | 0
  const z0 = cz | 0
  const wx = quintic(cx - x0)
  const wz = quintic(cz - z0)
  const i00 = z0 * stride + x0
  const a = data[i00]!
  const b = data[i00 + 1]!
  const c = data[i00 + stride]!
  const d = data[i00 + stride + 1]!
  const top = a + (b - a) * wx
  const bottom = c + (d - c) * wx
  return top + (bottom - top) * wz
}
