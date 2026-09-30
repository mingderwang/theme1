/**
 * Field smoothing helpers used between the raw heightfield and the appearance
 * bake.
 */

/** In place 3x3 box blur over the interior of a square grid. */
export const blurSquare = (
  data: Float32Array,
  stride: number,
  passes = 1,
  scratch?: Float32Array,
): void => {
  const tmp = scratch ?? new Float32Array(data.length)
  const last = stride - 1

  for (let pass = 0; pass < passes; pass++) {
    // horizontal
    for (let z = 0; z < stride; z++) {
      const row = z * stride
      for (let x = 0; x < stride; x++) {
        const l = data[row + (x > 0 ? x - 1 : 0)]!
        const c = data[row + x]!
        const r = data[row + (x < last ? x + 1 : last)]!
        tmp[row + x] = (l + c * 2 + r) * 0.25
      }
    }
    // vertical
    for (let z = 0; z < stride; z++) {
      const row = z * stride
      const up = (z > 0 ? z - 1 : 0) * stride
      const down = (z < last ? z + 1 : last) * stride
      for (let x = 0; x < stride; x++) {
        data[row + x] = (tmp[up + x]! + tmp[row + x]! * 2 + tmp[down + x]!) * 0.25
      }
    }
  }
}
