/**
 * Choosing where the water surface sits.
 *
 * In 'auto' mode the level is derived from the height histogram so that a
 * theme asking for "35% water" actually gets 35% water, whatever the terrain
 * happened to look like. In 'fixed' mode the theme's level is used verbatim.
 */

export interface WaterLevelOptions {
  mode: 'auto' | 'fixed'
  level: number
  /** Target fraction of the tile below the water surface, 0..1. */
  fraction: number
  minHeight: number
  maxHeight: number
  bins?: number
}

export interface WaterLevelResult {
  level: number
  coverage: number
  deepest: number
}

const BINS = 1024

export const resolveWaterLevel = (
  heights: Float32Array,
  options: WaterLevelOptions,
): WaterLevelResult => {
  const bins = options.bins ?? BINS
  const { minHeight, maxHeight } = options
  const span = Math.max(1e-6, maxHeight - minHeight)
  const histogram = new Float64Array(bins)

  for (let i = 0; i < heights.length; i++) {
    const t = (heights[i]! - minHeight) / span
    const bin = t <= 0 ? 0 : t >= 1 ? bins - 1 : (t * bins) | 0
    histogram[bin] = histogram[bin]! + 1
  }

  const total = heights.length
  const binHeight = (bin: number): number => minHeight + ((bin + 1) / bins) * span

  const levelForFraction = (fraction: number): number => {
    const target = total * Math.min(1, Math.max(0, fraction))
    let cumulative = 0
    for (let bin = 0; bin < bins; bin++) {
      cumulative += histogram[bin]!
      if (cumulative >= target) return binHeight(bin)
    }
    return maxHeight
  }

  const level = options.mode === 'fixed' ? options.level : levelForFraction(options.fraction)

  let below = 0
  for (let i = 0; i < heights.length; i++) {
    if (heights[i]! < level) below++
  }
  let deepest = 0
  for (let i = 0; i < heights.length; i++) {
    const depth = level - heights[i]!
    if (depth > deepest) deepest = depth
  }

  return { level, coverage: below / total, deepest }
}
