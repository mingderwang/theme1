/**
 * theme1 — procedural 3D environment generation and CPU image rendering.
 *
 * The one rule this library is built around: generation and rendering are
 * separate. A `World` is pure data describing a place; a renderer is one of
 * several ways to look at it. Nothing in `src/world` imports from `src/render`.
 *
 *   import { defineTheme, generateWorld, renderToPng } from 'theme1'
 *
 *   const world = generateWorld({ seed: 42, theme: defineTheme({ name: 'alpine' }) })
 *   await renderToPng('renders/alpine-42.png', { world })
 *
 * The same seed and theme always produce the same world and the same image.
 */

// --- core ------------------------------------------------------------------

export {
  clamp,
  clamp01,
  degToRad,
  falloff,
  fract,
  invLerp,
  lerp,
  lerp3,
  remap,
  smoothstep,
  smootherstep,
} from './core/math/index.ts'
export type { Rgb, Vec2, Vec3 } from './core/math/index.ts'

export { Rng, hash01, hashInts, hashString, streamSeed } from './core/rng/index.ts'
export { Perlin2, Perlin3, domainWarp2 } from './core/noise/index.ts'
export type { FbmOptions } from './core/noise/index.ts'
export {
  acesToneMap,
  hexToRgb,
  linearToSrgb,
  luminance,
  mixOklab,
  mixRgb,
  oklabToRgb,
  rgbToHex,
  rgbToOklab,
  reinhardToneMap,
  scaleRgb,
  srgbToLinear,
  toneMap,
} from './core/color/index.ts'
export type { ToneMapping } from './core/color/index.ts'

// --- theme -----------------------------------------------------------------

export { DEFAULT_THEME, defineTheme, tryDefineTheme, validateTheme, withQuality } from './theme/resolve.ts'
export type { ThemeValidation } from './theme/resolve.ts'
export { PRESETS, DEFAULT_PRESET_NAME } from './theme/presets/index.ts'
export { QUALITY_PROFILES } from './theme/types.ts'
export type {
  AtmosphereTheme,
  CloudTheme,
  DeepPartial,
  LightingTheme,
  MonochromeTheme,
  PaletteTheme,
  QualityProfile,
  RenderingTheme,
  SkyTheme,
  TerrainTheme,
  ThemeDraft,
  WaterTheme,
  WorldTheme,
} from './theme/types.ts'

// --- world -----------------------------------------------------------------

export { DEFAULT_SEED, generateWorld, worldKey } from './world/worldGenerator.ts'
export type { GenerateWorldOptions } from './world/worldGenerator.ts'
export { generateTerrainField } from './world/terrain/generator.ts'
export { bakeNormals } from './world/terrain/normals.ts'
export { bakeTerrainAppearance, resolvePalette, shadeTerrainCell } from './world/terrain/albedo.ts'
export { thermalErode } from './world/terrain/erosion.ts'
export { resolveWaterLevel } from './world/water/level.ts'
export type { WaterLevelOptions, WaterLevelResult } from './world/water/level.ts'
export {
  albedoAt,
  heightAt,
  heightAtExtended,
  normalAt,
  temperatureAt,
  moistureAt,
  slopeAt,
} from './world/terrain/sample.ts'
export type {
  Bounds,
  LightSample,
  TerrainField,
  WaterBody,
  World,
  WorldStats,
} from './world/types.ts'

// --- render ----------------------------------------------------------------

export { renderImage, renderToPng, renderToPngBytes } from './render/cpu/renderImage.ts'
export type { RenderImageOptions, RenderImageResult, WritePngResult } from './render/cpu/renderImage.ts'
export { createRenderContext } from './render/cpu/context.ts'
export type { RenderContext, TraceOptions } from './render/cpu/context.ts'
export { renderRay, createWaterShade, createScratch } from './render/cpu/shade.ts'
export type { RenderScratch } from './render/cpu/shade.ts'
export { traceTerrain, traceShadow, traceAmbientOcclusion, shadeTerrain } from './render/cpu/terrain.ts'
export { skyRadiance } from './render/cpu/sky.ts'
export { cloudDensity, marchClouds, phaseHG } from './render/cpu/clouds.ts'
export { shadeWater, waterNormal, waterPlaneHit } from './render/cpu/water.ts'
export { applyAerial, applySkyHaze, fogFactor } from './render/cpu/atmosphere.ts'
export { renderTileRows, buildTileRanges } from './render/cpu/tile.ts'

export { Camera } from './render/common/camera.ts'
export type { CameraSpec } from './render/common/camera.ts'
export { composeCamera } from './render/common/cameraPresets.ts'
export type { CameraPreset, ComposedCamera } from './render/common/cameraPresets.ts'
export { Framebuffer } from './render/common/framebuffer.ts'
export { present, encodeByte } from './render/common/colorPipeline.ts'
export type { PostSettings } from './render/common/colorPipeline.ts'
export { encodePng } from './render/png/encoder.ts'
export type { PngOptions } from './render/png/encoder.ts'
