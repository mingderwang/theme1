/**
 * The render context: everything a shading function needs, resolved once per
 * render job. Building this is the only place theme colors and hex strings
 * are decoded, so the per-pixel code never allocates or parses.
 */

import { Perlin2, Perlin3 } from '../../core/noise/index.ts'
import { hexToRgb, scaleRgb } from '../../core/color/index.ts'
import { degToRad } from '../../core/math/index.ts'
import type { Rgb } from '../../core/math/index.ts'
import { streamSeed } from '../../core/rng/index.ts'
import type { TerrainField, World } from '../../world/types.ts'
import { createScratch, createWaterShade, type RenderScratch } from './shade.ts'
import type { WaterShadeOptions } from './water.ts'

export interface TraceOptions {
  maxDistance: number
  stepScale: number
  minStep: number
  maxSteps: number
  refineSteps: number
  shadowSteps: number
  shadowMaxDistance: number
  shadowSoftness: number
  shadowMinStep: number
  aoEnabled: boolean
  aoStrength: number
  aoRadius: number
  aoSamples: number
  /** Samples along the view ray through the cloud slab. */
  cloudSteps: number
  /** Samples towards the sun inside the cloud medium. */
  cloudLightSteps: number
  waterReflections: boolean
  cloudShadows: boolean
}

export interface RenderContext {
  world: World
  field: TerrainField
  time: number
  options: TraceOptions

  sunX: number
  sunY: number
  sunZ: number
  sunRadiance: Rgb
  skyAmbient: Rgb
  groundAmbient: Rgb
  ambientTotal: Rgb

  skyZenith: Rgb
  skyHorizon: Rgb
  skyGround: Rgb
  sunDiscColor: Rgb
  sunGlowColor: Rgb
  sunAngularRadius: number
  fogColor: Rgb
  sunFogColor: Rgb

  waterEnabled: boolean
  waterLevel: number
  waterShallow: Rgb
  waterDeep: Rgb
  foamColor: Rgb

  cloudsEnabled: boolean
  cloudBase: number
  cloudTop: number
  cloudLit: Rgb
  cloudShadow: Rgb

  waveNoise: Perlin2
  cloudNoise: Perlin3
  cloudErosionNoise: Perlin3
  cloudShadowNoise: Perlin2

  /**
   * Sun rotation, in radians, used to dither shadow penumbras.
   * The render loop sets this per pixel from a hash of the pixel index.
   */
  ditherAngle: number

  /** Camera position, used to fade out high frequency detail with distance. */
  viewX: number
  viewY: number
  viewZ: number

  /** Reusable buffers so the per pixel path never allocates. */
  scratch: RenderScratch
  /** Callbacks handed to the water shader. */
  waterShade: WaterShadeOptions
}

export const createRenderContext = (world: World, time: number): RenderContext => {
  const theme = world.theme
  const r = theme.rendering
  const light = world.light
  const d = light.direction

  const skyZenith = hexToRgb(theme.sky.zenithColor)
  const skyHorizon = hexToRgb(theme.sky.horizonColor)
  const skyGround = hexToRgb(theme.sky.groundColor)
  const fogColor = hexToRgb(theme.atmosphere.fogColor)
  const waterEnabled = theme.water.enabled && world.terrain.hasWater

  const ambientTotal: Rgb = {
    r: light.skyAmbient.r + light.groundAmbient.r * 0.4,
    g: light.skyAmbient.g + light.groundAmbient.g * 0.4,
    b: light.skyAmbient.b + light.groundAmbient.b * 0.4,
  }

  const seed = streamSeed(streamSeed(world.seed, theme.name), 'render')

  const ctx: RenderContext = {
    world,
    field: world.terrain,
    time,
    options: {
      maxDistance: r.maxDistance,
      stepScale: r.stepScale,
      minStep: r.minStep,
      maxSteps: r.maxSteps,
      refineSteps: r.refineSteps,
      shadowSteps: theme.lighting.shadows.steps,
      shadowMaxDistance: theme.lighting.shadows.maxDistance,
      shadowSoftness: theme.lighting.shadows.softness,
      shadowMinStep: Math.max(1.5, r.minStep * 2),
      aoEnabled: theme.lighting.ambientOcclusion.enabled,
      aoStrength: theme.lighting.ambientOcclusion.strength,
      aoRadius: theme.lighting.ambientOcclusion.radius,
      aoSamples: theme.lighting.ambientOcclusion.samples,
      cloudSteps: r.cloudSteps,
      cloudLightSteps: r.cloudLightSteps,
      waterReflections: theme.water.reflections,
      cloudShadows: theme.cloud.shadowStrength > 0,
    },

    sunX: d.x,
    sunY: d.y,
    sunZ: d.z,
    sunRadiance: light.radiance,
    skyAmbient: light.skyAmbient,
    groundAmbient: light.groundAmbient,
    ambientTotal,

    skyZenith,
    skyHorizon,
    skyGround,
    sunDiscColor: scaleRgb(light.sunColor, Math.max(1, light.sunIntensity) * 3),
    /**
     * Scattering uses a much dimmer copy of the sun than the disc does.
     * Using the disc radiance here blows the whole sun side of the sky past
     * white and the tone mapper turns the gradient into a hard edge.
     */
    sunGlowColor: scaleRgb(light.sunColor, light.sunIntensity * 0.22),
    sunAngularRadius: degToRad(light.sunAngularRadius),
    fogColor,
    sunFogColor: scaleRgb(light.sunColor, 1.4),

    waterEnabled,
    waterLevel: world.terrain.waterLevel,
    waterShallow: hexToRgb(theme.water.shallowColor),
    waterDeep: hexToRgb(theme.water.deepColor),
    foamColor: hexToRgb(theme.water.foam),

    cloudsEnabled: theme.cloud.enabled && theme.cloud.coverage > 0.001,
    cloudBase: theme.cloud.baseAltitude,
    cloudTop: theme.cloud.topAltitude,
    cloudLit: hexToRgb(theme.cloud.litColor),
    cloudShadow: hexToRgb(theme.cloud.shadowColor),

    waveNoise: new Perlin2(seed ^ 0x1f83d9ab),
    cloudNoise: new Perlin3(seed ^ 0x5bd1e995),
    cloudErosionNoise: new Perlin3(seed ^ 0xc2b2ae35),
    cloudShadowNoise: new Perlin2(seed ^ 0x27d4eb2f),
    ditherAngle: 0,
    viewX: 0,
    viewY: 0,
    viewZ: 0,
    scratch: createScratch(),
    waterShade: undefined as unknown as WaterShadeOptions,
  }

  ctx.waterShade = createWaterShade(ctx)
  return ctx
}
