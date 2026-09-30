/**
 * A theme is pure configuration. Generators and renderers read it and never
 * branch on a theme *name* — adding a new look means adding data, not code.
 */

import type { Rgb, Vec3 } from '../core/math/index.ts'
import type { ToneMapping } from '../core/color/index.ts'

export type HexColor = string

export interface ErosionTheme {
  /** Thermal erosion: material above the talus angle slides downhill. */
  enabled: boolean
  iterations: number
  /** Maximum stable slope, in degrees. */
  talusAngle: number
  /** Fraction of the excess moved per iteration, 0..1. */
  rate: number
  /** Extra isotropic smoothing applied per iteration, 0..1. */
  diffusion: number
}

export interface MoistureTheme {
  frequency: number
  octaves: number
  gain: number
  /** Extra moisture near the water surface, 0..1. */
  seaInfluence: number
  /** Moisture lost on steep ground, 0..1. */
  runoff: number
  /**
   * Contrast applied around the midpoint, >= 1.
   *
   * Normalized fractal noise clusters tightly around 0.5, so without this the
   * entire range of wet ground occupies a sliver of the distribution and every
   * material mask built on it degenerates into thin contour-following bands.
   */
  contrast: number
}

export interface ClimateTheme {
  /** Temperature in degrees at sea level. */
  seaLevelTemperature: number
  /** Degrees lost per meter of elevation. */
  lapseRate: number
  /** Amplitude of the large scale temperature variation, in degrees. */
  variation: number
  frequency: number
}

export interface TerrainTheme {
  /** Width and depth of the world tile, in meters. */
  worldSize: number
  /** Heightfield cells per side. Samples are (resolution+1)^2. */
  resolution: number
  /** Vertical range of the land, in meters. */
  amplitude: number
  /** Feature size of the primary mountain noise, in cells. */
  featureSize: number
  octaves: number
  lacunarity: number
  gain: number
  /** How much ridged noise is mixed into the smooth fBm, 0..1. */
  ridgedMix: number
  ridgeSharpness: number
  /** Domain warping: breaks up the grid aligned look of raw fBm. */
  warpStrength: number
  warpFrequency: number
  /** Large scale land vs ocean mask. */
  shapeFeatureSize: number
  shapeOctaves: number
  /** Shape noise value at which the coastline sits. */
  seaThreshold: number
  /** Width of the coastal transition, in shape noise units. */
  coastSoftness: number
  /** Depth of the ocean floor below sea level, in meters. */
  seaDepth: number
  /**
   * 0 keeps the tile edge as it is, 1 tapers the whole world into open sea at
   * its border. Without this the tile boundary reads as a cliff into nothing.
   */
  edgeFalloff: number
  /** Width of that taper as a fraction of the tile radius, 0..1. */
  edgeWidth: number
  seaLevel: number
  seaLevelMode: 'auto' | 'fixed'
  /** Fraction of the tile covered by water when seaLevelMode is 'auto'. */
  waterFraction: number
  erosion: ErosionTheme
  moisture: MoistureTheme
  climate: ClimateTheme
}

export interface WaterTheme {
  enabled: boolean
  level: number
  levelMode: 'auto' | 'fixed'
  /** 1.0 for water, roughly 0.75 for stylized shallow water. */
  ior: number
  /** Extinction per meter of water travelled. */
  turbidity: number
  deepColor: HexColor
  shallowColor: HexColor
  fresnelPower: number
  /** How much of the sky the surface returns at grazing angles. */
  reflectivity: number
  /** Secondary ray budget: 0 disables reflections. */
  reflections: boolean
  waveScale: number
  waveSpeed: number
  waveDetail: number
  /** Depth over which shallow water blends to deep water, in meters. */
  depthFade: number
  /** Foam appears within this depth of the surface. */
  foamDepth: number
  foam: HexColor
}

export interface CloudTheme {
  enabled: boolean
  /** 0 = clear sky, 1 = overcast. */
  coverage: number
  /** Extinction scale of the cloud medium. */
  density: number
  baseAltitude: number
  topAltitude: number
  featureSize: number
  octaves: number
  /** Octaves of high frequency detail subtracted from the density. */
  erosionOctaves: number
  /** Cloud base lumpiness, before coverage is applied. */
  billow: number
  /** Scattering anisotropy, -1..1. */
  anisotropy: number
  /** Ambient light the cloud medium receives from the sky. */
  ambient: number
  /** Tint applied to the lit side of the cloud. */
  litColor: HexColor
  shadowColor: HexColor
  /** World space drift, added to the sampling position. */
  wind: Vec3
  /** Shadows cast by clouds onto the terrain, 0..1. */
  shadowStrength: number
}

export interface SkyTheme {
  zenithColor: HexColor
  horizonColor: HexColor
  /** Color used for rays pointing below the horizon that miss the terrain. */
  groundColor: HexColor
  /** How tightly the sun's glow hugs the horizon, 0..1. */
  turbidity: number
  /** Broad forward scattering lobe around the sun. */
  mie: number
  rayleigh: number
  sunGlow: number
  /** Angular radius of the visible sun disc, in degrees. */
  sunSize: number
  /** Star density, 0 disables the star pass. */
  stars: number
}

export interface AtmosphereTheme {
  /** Fog density at sea level, per meter. */
  fogDensity: number
  /** How quickly fog thins with altitude, in meters. */
  fogHeight: number
  fogColor: HexColor
  /** Extra in-scattering towards the sun, 0..1. */
  sunScatter: number
  /** Overall strength of the aerial perspective, 0..1. */
  scattering: number
  /** Overall haze gain on top of the distance fog. */
  haze: number
}

export interface LightingTheme {
  /** Unit vector pointing from the world towards the sun. */
  sunDirection: Vec3
  sunColor: HexColor
  sunIntensity: number
  /** Sky color arriving from above, drives ambient on terrain. */
  ambientSkyColor: HexColor
  /** Bounce color arriving from below. */
  ambientGroundColor: HexColor
  ambientIntensity: number
  shadows: {
    enabled: boolean
    /** Ray budget for the shadow march. */
    steps: number
    /** Angular jitter in degrees, converts hard edges into penumbra. */
    softness: number
    maxDistance: number
  }
  ambientOcclusion: {
    enabled: boolean
    strength: number
    /** Sample distance in meters. */
    radius: number
    samples: number
  }
}

export interface PaletteTheme {
  /** Dry, warm lowland. */
  dryColor: HexColor
  /** Temperate grassland. */
  grassColor: HexColor
  /** Wet lowland and forest floor. */
  forestColor: HexColor
  /** Rock and cliff faces. */
  rockColor: HexColor
  /** Peaks above the rock band. */
  highlandColor: HexColor
  /** Snow and ice. */
  snowColor: HexColor
  /** Sand and shingle along the shore. */
  sandColor: HexColor
  /** Lake and ocean floor. */
  underwaterColor: HexColor
  /**
   * Elevation where vegetation gives out, in meters.
   *
   * Slope alone is not enough to place rock. In steep country the median slope
   * is above any sensible rock threshold, so a slope-only mask covers the whole
   * world. The treeline is what produces the banding a real range has:
   * forest, then alpine meadow, then bare rock, then snow.
   */
  treeLine: number
  /** Width of that transition band, in meters. */
  treeLineBlend: number
  /** Elevation where snow starts to appear, in meters. */
  snowLine: number
  /** Width of the snow transition band, in meters. */
  snowBlend: number
  /** Slope (0..1, where 1 is 45 degrees) at which rock takes over. */
  rockSlope: number
  /** Slope at which snow can no longer stick. */
  snowSlope: number
  /** Extra color variation applied with a low frequency noise, 0..1. */
  variation: number
  variationColor: HexColor
}

export interface MonochromeTheme {
  enabled: boolean
  /** S-curve contrast around 0.18. */
  contrast: number
  /** Lifted black point. */
  lift: number
  /** Tonemap gain applied after desaturation. */
  gain: number
  /** Color multiplied into the result; keep near white for pure grayscale. */
  tint: HexColor
}

export interface RenderingTheme {
  width: number
  height: number
  quality: 'preview' | 'standard' | 'high'
  /** Per axis antialiasing factor: 1, 2 or 3. */
  supersampling: number
  maxDistance: number
  /** Fraction of the current distance used as the march step. */
  stepScale: number
  minStep: number
  maxSteps: number
  /** Bisection steps used to land on the surface after a crossing. */
  refineSteps: number
  /** Samples along the view ray for the volumetric cloud pass. */
  cloudSteps: number
  /** Samples towards the sun inside the cloud medium. */
  cloudLightSteps: number
  toneMapping: ToneMapping
  exposure: number
  /** Global saturation multiplier applied after tone mapping. */
  saturation: number
  vignette: number
  grain: number
  monochrome: MonochromeTheme
}

export interface WorldTheme {
  name: string
  version: number
  seed: number
  terrain: TerrainTheme
  water: WaterTheme
  cloud: CloudTheme
  sky: SkyTheme
  atmosphere: AtmosphereTheme
  lighting: LightingTheme
  palette: PaletteTheme
  rendering: RenderingTheme
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K]
}

/** A theme where every field is optional. `defineTheme` fills the gaps. */
export type ThemeDraft = DeepPartial<WorldTheme>

export interface QualityProfile {
  supersampling: number
  maxSteps: number
  cloudSteps: number
  cloudLightSteps: number
  shadowSteps: number
  aoSamples: number
}

export const QUALITY_PROFILES: Record<RenderingTheme['quality'], QualityProfile> = {
  preview: { supersampling: 1, maxSteps: 220, cloudSteps: 14, cloudLightSteps: 2, shadowSteps: 28, aoSamples: 2 },
  standard: { supersampling: 2, maxSteps: 460, cloudSteps: 34, cloudLightSteps: 3, shadowSteps: 72, aoSamples: 6 },
  high: { supersampling: 3, maxSteps: 900, cloudSteps: 72, cloudLightSteps: 5, shadowSteps: 160, aoSamples: 8 },
}

export type { Rgb }
