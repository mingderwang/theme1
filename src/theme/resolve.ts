/**
 * Theme defaults, deep merging, validation and the preset registry.
 *
 * `defineTheme` is the only supported way to build a theme: it merges a draft
 * over the defaults, applies quality-dependent overrides and validates the
 * result. Generators can therefore assume every field exists.
 */

import { clamp } from '../core/math/index.ts'
import type { ThemeDraft, WorldTheme, RenderingTheme } from './types.ts'
import { QUALITY_PROFILES } from './types.ts'

export const DEFAULT_THEME: WorldTheme = {
  name: 'default',
  version: 1,
  seed: 0,

  terrain: {
    worldSize: 2400,
    resolution: 1024,
    amplitude: 420,
    featureSize: 1400,
    octaves: 9,
    lacunarity: 2.03,
    gain: 0.5,
    ridgedMix: 0.45,
    ridgeSharpness: 1.0,
    warpStrength: 0.35,
    warpFrequency: 0.6,
    shapeFeatureSize: 5200,
    shapeOctaves: 4,
    seaThreshold: 0.05,
    coastSoftness: 0.15,
    seaDepth: 90,
    edgeFalloff: 0.8,
    edgeWidth: 0.3,
    seaLevel: 0,
    seaLevelMode: 'auto',
    waterFraction: 0.34,
    erosion: {
      enabled: true,
      iterations: 12,
      talusAngle: 34,
      rate: 0.35,
      diffusion: 0.02,
    },
    moisture: {
      frequency: 2.1,
      octaves: 4,
      gain: 0.5,
      seaInfluence: 0.28,
      runoff: 0.35,
      contrast: 2,
    },
    climate: {
      seaLevelTemperature: 14,
      lapseRate: 0.0065,
      variation: 5,
      frequency: 0.7,
    },
  },

  water: {
    enabled: true,
    level: 0,
    levelMode: 'auto',
    ior: 1.333,
    turbidity: 0.045,
    deepColor: '#0b2f3a',
    shallowColor: '#2f8f92',
    fresnelPower: 5,
    reflectivity: 1,
    reflections: true,
    waveScale: 1,
    waveSpeed: 0.02,
    waveDetail: 1,
    depthFade: 14,
    foamDepth: 1.6,
    foam: '#e8f2f4',
  },

  cloud: {
    enabled: true,
    coverage: 0.42,
    density: 0.9,
    baseAltitude: 900,
    topAltitude: 1700,
    featureSize: 2600,
    octaves: 5,
    erosionOctaves: 3,
    billow: 0.4,
    anisotropy: 0.35,
    ambient: 0.35,
    litColor: '#ffffff',
    shadowColor: '#8fa3bd',
    wind: { x: 1, y: 0, z: 0.25 },
    shadowStrength: 0.5,
  },

  sky: {
    zenithColor: '#2a5f9e',
    horizonColor: '#bcd2e4',
    groundColor: '#3b3a36',
    turbidity: 0.4,
    mie: 0.6,
    rayleigh: 1,
    sunGlow: 1,
    sunSize: 0.6,
    stars: 0,
  },

  atmosphere: {
    fogDensity: 0.00016,
    fogHeight: 900,
    fogColor: '#c3d4e6',
    sunScatter: 0.55,
    scattering: 1,
    haze: 1,
  },

  lighting: {
    sunDirection: { x: 0.42, y: 0.36, z: -0.83 },
    sunColor: '#fff4e2',
    sunIntensity: 3.1,
    ambientSkyColor: '#9dc2ea',
    ambientGroundColor: '#5a5142',
    ambientIntensity: 0.55,
    shadows: {
      enabled: true,
      steps: 72,
      softness: 0.6,
      maxDistance: 2600,
    },
    ambientOcclusion: {
      enabled: true,
      strength: 0.7,
      radius: 26,
      samples: 3,
    },
  },

  palette: {
    dryColor: '#a8925e',
    grassColor: '#6f8449',
    forestColor: '#3c5c33',
    rockColor: '#6b6660',
    highlandColor: '#8b8578',
    snowColor: '#f2f6f8',
    sandColor: '#c9b489',
    underwaterColor: '#2e4a4a',
    treeLine: 300,
    treeLineBlend: 260,
    snowLine: 520,
    snowBlend: 130,
    rockSlope: 0.42,
    snowSlope: 0.75,
    variation: 0.18,
    variationColor: '#6d5f45',
  },

  rendering: {
    width: 1280,
    height: 720,
    quality: 'standard',
    supersampling: 2,
    maxDistance: 12000,
    stepScale: 0.03,
    minStep: 0.6,
    maxSteps: 460,
    refineSteps: 8,
    cloudSteps: 34,
    cloudLightSteps: 3,
    toneMapping: 'aces',
    exposure: 1,
    saturation: 1,
    vignette: 0.22,
    grain: 0.012,
    monochrome: {
      enabled: false,
      contrast: 1.15,
      lift: 0.01,
      gain: 1.05,
      tint: '#ffffff',
    },
  },
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Recursive merge where `undefined` in the patch keeps the base value.
 *  Arrays and primitives are replaced wholesale. */
const deepMerge = <T>(base: T, patch: unknown): T => {
  if (patch === undefined) return base
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch as T
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    out[key] = deepMerge((base as Record<string, unknown>)[key], value)
  }
  return out as T
}

const normalizeSun = (theme: WorldTheme): WorldTheme => {
  const d = theme.lighting.sunDirection
  const len = Math.hypot(d.x, d.y, d.z) || 1
  theme.lighting = {
    ...theme.lighting,
    sunDirection: { x: d.x / len, y: d.y / len, z: d.z / len },
  }
  return theme
}

/**
 * Apply the quality profile to any step budget the theme left at its default.
 *
 * A value that differs from the default was authored deliberately, so the
 * profile must not overwrite it. That is what makes it safe to hand write a
 * theme with `shadows.steps: 10` and still ask for standard quality.
 */
const applyQuality = (theme: WorldTheme): WorldTheme => {
  const profile = QUALITY_PROFILES[theme.rendering.quality] ?? QUALITY_PROFILES.standard
  const rendering: RenderingTheme = { ...theme.rendering }
  const shadows = { ...theme.lighting.shadows }
  const ao = { ...theme.lighting.ambientOcclusion }

  const wasDefault = (value: number, fallback: number): boolean => value === fallback
  const base = DEFAULT_THEME.rendering

  if (wasDefault(rendering.supersampling, base.supersampling)) {
    rendering.supersampling = profile.supersampling
  }
  if (wasDefault(rendering.maxSteps, base.maxSteps)) rendering.maxSteps = profile.maxSteps
  if (wasDefault(rendering.cloudSteps, base.cloudSteps)) rendering.cloudSteps = profile.cloudSteps
  if (wasDefault(rendering.cloudLightSteps, base.cloudLightSteps)) {
    rendering.cloudLightSteps = profile.cloudLightSteps
  }
  if (wasDefault(shadows.steps, DEFAULT_THEME.lighting.shadows.steps)) {
    shadows.steps = profile.shadowSteps
  }
  if (wasDefault(ao.samples, DEFAULT_THEME.lighting.ambientOcclusion.samples)) {
    ao.samples = profile.aoSamples
  }

  return {
    ...theme,
    rendering,
    lighting: { ...theme.lighting, shadows, ambientOcclusion: ao },
  }
}

/**
 * Apply a quality profile to an already resolved theme, unconditionally.
 *
 * `defineTheme` only fills in budgets the draft left at their default, so
 * authored values win. This is the other direction: an explicit request for a
 * quality level is explicit intent, so the profile applies even to values an
 * earlier `defineTheme` filled in. Without that, switching a resolved theme
 * from 'high' down to 'preview' would silently do nothing.
 */
export const withQuality = (
  theme: WorldTheme,
  quality: RenderingTheme['quality'],
): WorldTheme => {
  const profile = QUALITY_PROFILES[quality] ?? QUALITY_PROFILES.standard
  return {
    ...theme,
    rendering: {
      ...theme.rendering,
      quality,
      supersampling: profile.supersampling,
      maxSteps: profile.maxSteps,
      cloudSteps: profile.cloudSteps,
      cloudLightSteps: profile.cloudLightSteps,
    },
    lighting: {
      ...theme.lighting,
      shadows: { ...theme.lighting.shadows, steps: profile.shadowSteps },
      ambientOcclusion: { ...theme.lighting.ambientOcclusion, samples: profile.aoSamples },
    },
  }
}

export interface ThemeValidation {
  errors: string[]
  warnings: string[]
}

/** Range checks that catch the mistakes a hand written theme actually makes. */
export const validateTheme = (theme: WorldTheme): ThemeValidation => {
  const errors: string[] = []
  const warnings: string[] = []
  const t = theme.terrain
  const r = theme.rendering

  if (t.resolution < 16) errors.push('terrain.resolution must be at least 16')
  if (t.worldSize <= 0) errors.push('terrain.worldSize must be positive')
  if (t.amplitude < 0) errors.push('terrain.amplitude must not be negative')
  if (t.featureSize <= 0) errors.push('terrain.featureSize must be positive')
  if (t.octaves < 1) errors.push('terrain.octaves must be at least 1')
  if (t.octaves > 20) warnings.push('terrain.octaves above 20 is very slow')
  if (t.ridgedMix < 0 || t.ridgedMix > 1) errors.push('terrain.ridgedMix must be 0..1')
  if (t.waterFraction <= 0 || t.waterFraction >= 0.95) {
    warnings.push('terrain.waterFraction outside (0, 0.95) will give a dry or flooded world')
  }
  if (t.amplitude > t.worldSize) {
    warnings.push('terrain.amplitude larger than worldSize produces near vertical cliffs')
  }

  if (r.width < 1 || r.height < 1) errors.push('rendering.width and rendering.height must be positive')
  if (r.maxDistance <= 0) errors.push('rendering.maxDistance must be positive')
  if (r.stepScale <= 0) errors.push('rendering.stepScale must be positive')
  if (r.minStep <= 0) errors.push('rendering.minStep must be positive')

  if (theme.cloud.enabled) {
    if (theme.cloud.topAltitude <= theme.cloud.baseAltitude) {
      errors.push('cloud.topAltitude must be greater than cloud.baseAltitude')
    }
    if (theme.cloud.density <= 0) warnings.push('cloud.density is zero, clouds will be invisible')
  }
  if (theme.lighting.sunDirection.y <= 0.02) {
    warnings.push('sun is at or below the horizon: the terrain will be almost unlit')
  }
  if (theme.lighting.sunIntensity <= 0) warnings.push('lighting.sunIntensity is zero')
  if (theme.water.enabled && theme.water.turbidity <= 0) {
    warnings.push('water.turbidity is zero, water will be perfectly clear')
  }

  return { errors, warnings }
}

/** Merge a draft over the defaults, apply the quality profile and validate. */
export const defineTheme = (draft: ThemeDraft = {}): WorldTheme => {
  const merged = deepMerge(DEFAULT_THEME, draft)
  const theme = normalizeSun(applyQuality(merged))
  const { errors } = validateTheme(theme)
  if (errors.length > 0) {
    throw new Error(`Invalid theme "${theme.name}":\n  - ${errors.join('\n  - ')}`)
  }
  return theme
}

/** Same as `defineTheme` but never throws; validation results are returned. */
export const tryDefineTheme = (
  draft: ThemeDraft = {},
): { theme: WorldTheme; validation: ThemeValidation } => {
  const merged = normalizeSun(applyQuality(deepMerge(DEFAULT_THEME, draft)))
  return { theme: merged, validation: validateTheme(merged) }
}

export const clampQuality = (q: string): RenderingTheme['quality'] =>
  q === 'preview' || q === 'high' || q === 'standard' ? q : 'standard'

export { clamp }
