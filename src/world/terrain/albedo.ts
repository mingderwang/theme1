/**
 * Baking terrain appearance into byte buffers.
 *
 * This runs once at generation time. The renderer only ever bilinearly reads
 * `albedo` and `roughness`, so a "material" in this project is a data product,
 * not a shader. Swapping this pass for one that writes GPGPU textures later
 * would not change any renderer code.
 */

import { clamp01, lerp, smoothstep } from '../../core/math/index.ts'
import { hexToRgb, mixRgb } from '../../core/color/index.ts'
import type { PaletteTheme, TerrainTheme } from '../../theme/types.ts'
import type { Rgb } from '../../core/math/index.ts'
import type { Perlin2 } from '../../core/noise/index.ts'
import type { TerrainField } from '../types.ts'
import { linearToSrgbByte } from './sample.ts'

export interface BakedPalette {
  dry: Rgb
  grass: Rgb
  forest: Rgb
  rock: Rgb
  highland: Rgb
  snow: Rgb
  sand: Rgb
  underwater: Rgb
  variation: Rgb
}

export const resolvePalette = (palette: PaletteTheme): BakedPalette => ({
  dry: hexToRgb(palette.dryColor),
  grass: hexToRgb(palette.grassColor),
  forest: hexToRgb(palette.forestColor),
  rock: hexToRgb(palette.rockColor),
  highland: hexToRgb(palette.highlandColor),
  snow: hexToRgb(palette.snowColor),
  sand: hexToRgb(palette.sandColor),
  underwater: hexToRgb(palette.underwaterColor),
  variation: hexToRgb(palette.variationColor),
})

/**
 * Per cell surface appearance, as a function of the terrain descriptors.
 * Exported so the three.js viewer can shade at a different resolution, and so
 * this can be unit tested without building a whole field.
 */
export const shadeTerrainCell = (
  height: number,
  slope: number,
  moisture: number,
  temperature: number,
  seaLevel: number,
  palette: PaletteTheme,
  colors: BakedPalette,
  variation: number,
  out: Rgb,
): number => {
  const aboveWater = height - seaLevel

  // Vegetation cover: dry ground is pale, wet ground dark green.
  const wetMask = smoothstep(0.25, 0.62, moisture)
  const forestMask = smoothstep(0.55, 0.85, moisture) * (1 - smoothstep(24, 32, temperature))
  let color = mixRgb(colors.dry, colors.grass, wetMask)
  color = mixRgb(color, colors.forest, forestMask * 0.9)

  // Cold high ground loses vegetation. The threshold is well below freezing
  // rather than merely cool: an alpine lowland at 6 degrees is still green.
  const coldMask = smoothstep(1, -13, temperature) * (1 - smoothstep(0.5, 0.85, slope))

  // Treeline. Above it vegetation thins to alpine turf and then to bare rock.
  // Without this the only thing separating green from grey is slope, and in
  // steep country slope alone paints the entire world grey.
  const aboveTree = smoothstep(palette.treeLine, palette.treeLine + palette.treeLineBlend, height)
  color = mixRgb(color, colors.highland, aboveTree * (1 - coldMask) * 0.7)
  color = mixRgb(color, colors.rock, aboveTree * 0.6)

  // Beach: a narrow band just above the waterline, on gentle ground only.
  const beach =
    smoothstep(-7, -1.5, aboveWater) *
    (1 - smoothstep(5, 15, aboveWater)) *
    (1 - smoothstep(0.16, 0.34, slope))
  color = mixRgb(color, colors.sand, beach * 0.92)

  // Exposed rock on steep faces, independent of altitude.
  const slopeRock = smoothstep(palette.rockSlope, palette.rockSlope + 0.3, slope)
  color = mixRgb(color, colors.rock, slopeRock * 0.8)

  // Snow: above the snow line, but it will not hold on a steep face.
  const snowAltitude = smoothstep(palette.snowLine, palette.snowLine + palette.snowBlend, height)
  const snowSlope = 1 - smoothstep(palette.snowSlope * 0.55, palette.snowSlope, slope)
  const snowMask = clamp01(snowAltitude * snowSlope * (1 - coldMask * 0.5))
  color = mixRgb(color, colors.snow, snowMask)

  // Lake and ocean floor.
  const submerged = 1 - smoothstep(-9, 0.5, aboveWater)
  color = mixRgb(color, colors.underwater, submerged)

  // Low frequency color variation so large faces are not flat.
  color = mixRgb(color, colors.variation, clamp01(variation) * 0.5)

  // Wet sand and shallow water read darker.
  const wet = smoothstep(2.5, -1, aboveWater) * (1 - submerged * 0.5)
  const darken = 1 - 0.22 * wet
  color.r *= darken
  color.g *= darken
  color.b *= darken

  out.r = color.r
  out.g = color.g
  out.b = color.b

  // Roughness: rock and snow are smoother than vegetation and sand.
  const rockAmount = clamp01(Math.max(aboveTree * 0.6, slopeRock * 0.8))
  const roughness = lerp(0.95, 0.72, rockAmount) * lerp(1, 0.62, snowMask) * lerp(1, 0.9, submerged)
  return clamp01(roughness)
}

/** Fill `albedo` and `roughness` for an already generated heightfield. */
export const bakeTerrainAppearance = (
  field: TerrainField,
  terrain: TerrainTheme,
  palette: PaletteTheme,
  waterLevel: number,
  variationNoise: Perlin2,
): void => {
  const colors = resolvePalette(palette)
  const { stride, heights, slope, moisture, temperature, albedo, roughness } = field
  const cell: Rgb = { r: 0, g: 0, b: 0 }
  const variationScale = 3.1 / Math.max(1, terrain.worldSize)

  for (let z = 0; z < stride; z++) {
    const wz = (z * field.cell - field.size * 0.5) * variationScale
    for (let x = 0; x < stride; x++) {
      const i = z * stride + x
      const variation = clamp01(
        0.5 + 0.5 * variationNoise.fbm((x * field.cell - field.size * 0.5) * variationScale, wz, {
          octaves: 3,
          lacunarity: 2.1,
          gain: 0.55,
        }),
      )

      const r = shadeTerrainCell(
        heights[i]!,
        slope[i]!,
        moisture[i]!,
        temperature[i]!,
        waterLevel,
        palette,
        colors,
        palette.variation * variation,
        cell,
      )

      const o = i * 3
      albedo[o] = linearToSrgbByte(cell.r)
      albedo[o + 1] = linearToSrgbByte(cell.g)
      albedo[o + 2] = linearToSrgbByte(cell.b)
      roughness[i] = (clamp01(r) * 255) | 0
    }
  }
}
