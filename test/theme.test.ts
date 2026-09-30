import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_THEME,
  defineTheme,
  tryDefineTheme,
  validateTheme,
  withQuality,
} from '../src/theme/resolve.ts'
import { PRESETS } from '../src/theme/presets/index.ts'
import { QUALITY_PROFILES } from '../src/theme/types.ts'
import type { ThemeDraft } from '../src/theme/types.ts'
import { hexToRgb, linearToSrgb, mixOklab, rgbToHex, srgbToLinear } from '../src/core/color/index.ts'
import { acesToneMap, luminance, reinhardToneMap } from '../src/core/color/index.ts'

describe('defineTheme', () => {
  test('fills in every field from a bare draft', () => {
    const theme = defineTheme()
    expect(theme.terrain.resolution).toBe(DEFAULT_THEME.terrain.resolution)
    expect(theme.rendering.quality).toBe(DEFAULT_THEME.rendering.quality)
  })

  test('merges nested objects instead of replacing them', () => {
    const theme = defineTheme({ terrain: { amplitude: 999 } })
    expect(theme.terrain.amplitude).toBe(999)
    // siblings survive the merge
    expect(theme.terrain.octaves).toBe(DEFAULT_THEME.terrain.octaves)
    expect(theme.terrain.erosion.talusAngle).toBe(DEFAULT_THEME.terrain.erosion.talusAngle)
  })

  test('merges deeply nested objects', () => {
    const theme = defineTheme({ terrain: { erosion: { rate: 0.9 } } })
    expect(theme.terrain.erosion.rate).toBe(0.9)
    expect(theme.terrain.erosion.iterations).toBe(DEFAULT_THEME.terrain.erosion.iterations)
  })

  test('ignores undefined rather than overwriting with undefined', () => {
    const theme = defineTheme({ terrain: { amplitude: undefined } })
    expect(theme.terrain.amplitude).toBe(DEFAULT_THEME.terrain.amplitude)
  })

  test('normalizes the sun direction', () => {
    const theme = defineTheme({ lighting: { sunDirection: { x: 0, y: 5, z: 0 } } })
    expect(theme.lighting.sunDirection.y).toBeCloseTo(1, 10)
  })

  test('the quality profile overrides the default step budgets', () => {
    for (const quality of ['preview', 'standard', 'high'] as const) {
      const theme = defineTheme({ rendering: { quality } })
      const profile = QUALITY_PROFILES[quality]
      expect(theme.rendering.maxSteps).toBe(profile.maxSteps)
      expect(theme.rendering.cloudSteps).toBe(profile.cloudSteps)
      expect(theme.rendering.supersampling).toBe(profile.supersampling)
      expect(theme.lighting.shadows.steps).toBe(profile.shadowSteps)
    }
  })

  test('an explicitly authored step budget beats the quality profile', () => {
    const theme = defineTheme({
      rendering: { quality: 'high', maxSteps: 33 },
      lighting: { shadows: { steps: 10 } },
    })
    expect(theme.rendering.maxSteps).toBe(33)
    expect(theme.lighting.shadows.steps).toBe(10)
  })

  test('withQuality re-applies a profile to an already resolved theme', () => {
    // Switching quality down has to actually change the budgets, otherwise a
    // theme resolved at 'high' can never be turned back down.
    const high = defineTheme({ rendering: { quality: 'high' } })
    expect(high.rendering.maxSteps).toBe(QUALITY_PROFILES.high.maxSteps)

    const preview = withQuality(high, 'preview')
    expect(preview.rendering.maxSteps).toBe(QUALITY_PROFILES.preview.maxSteps)
    expect(preview.rendering.supersampling).toBe(QUALITY_PROFILES.preview.supersampling)
    expect(preview.lighting.shadows.steps).toBe(QUALITY_PROFILES.preview.shadowSteps)
  })

  test('withQuality does not mutate its argument', () => {
    const theme = defineTheme({ rendering: { quality: 'high' } })
    const before = theme.rendering.maxSteps
    withQuality(theme, 'preview')
    expect(theme.rendering.maxSteps).toBe(before)
  })

  test('does not mutate the defaults', () => {
    const before = JSON.stringify(DEFAULT_THEME)
    defineTheme({ terrain: { amplitude: 1 }, rendering: { quality: 'high' } })
    expect(JSON.stringify(DEFAULT_THEME)).toBe(before)
  })

  test('throws on a theme that cannot be rendered', () => {
    expect(() => defineTheme({ terrain: { resolution: 1 } })).toThrow(/resolution/)
    expect(() => defineTheme({ cloud: { enabled: true, baseAltitude: 2000, topAltitude: 1000 } })).toThrow(
      /topAltitude/,
    )
  })

  test('tryDefineTheme reports problems instead of throwing', () => {
    const { theme, validation } = tryDefineTheme({ terrain: { resolution: 2 } })
    expect(validation.errors.length).toBeGreaterThan(0)
    expect(theme.terrain.resolution).toBe(2)
  })
})

describe('validateTheme', () => {
  test('the defaults are valid', () => {
    expect(validateTheme(defineTheme()).errors).toEqual([])
  })

  test('warns without failing on a sun below the horizon', () => {
    const { validation } = tryDefineTheme({ lighting: { sunDirection: { x: 1, y: 0, z: 0 } } })
    expect(validation.errors).toEqual([])
    expect(validation.warnings.join(' ')).toMatch(/horizon/i)
  })
})

describe('presets', () => {
  const names = Object.keys(PRESETS)

  test('there is at least one preset', () => {
    expect(names.length).toBeGreaterThan(0)
  })

  test('every preset resolves to a valid, fully populated theme', () => {
    for (const name of names) {
      const theme = defineTheme({ ...PRESETS[name], name })
      const { errors } = validateTheme(theme)
      expect(errors, `${name}: ${errors.join(', ')}`).toEqual([])
    }
  })

  test('no preset leaves a field undefined', () => {
    const walk = (value: unknown, path: string, name: string): void => {
      if (value === null || value === undefined) {
        throw new Error(`${name} has an undefined value at ${path}`)
      }
      if (typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`, name)
      }
    }
    for (const name of names) walk(defineTheme({ ...PRESETS[name], name }), name, name)
  })

  test('presets do not share mutable state with each other', () => {
    // A preset that mutates a nested object would corrupt the registry for
    // every later render, so build each one twice and compare.
    for (const name of names) {
      const a = defineTheme({ ...PRESETS[name], name })
      a.terrain.amplitude = 1
      a.lighting.shadows.enabled = false
      const b = defineTheme({ ...PRESETS[name], name })
      expect(b.terrain.amplitude).toBe(PRESETS[name]!.terrain?.amplitude ?? DEFAULT_THEME.terrain.amplitude)
      expect(b.lighting.shadows.enabled).toBe(true)
    }
  })
})

describe('color', () => {
  test('sRGB round trips', () => {
    for (const c of [0, 0.04, 0.2, 0.5, 0.9, 1]) {
      expect(srgbToLinear(linearToSrgb(c))).toBeCloseTo(c, 6)
    }
  })

  test('hex round trips through linear', () => {
    for (const hex of ['#000000', '#ffffff', '#3c5c33', '#fff1dc', '#0d2b3d']) {
      expect(rgbToHex(hexToRgb(hex))).toBe(hex)
    }
  })

  test('accepts short hex and a missing hash', () => {
    expect(hexToRgb('#fff')).toEqual(hexToRgb('ffffff'))
    expect(hexToRgb('ff0000')).toEqual(hexToRgb('#ff0000'))
  })

  test('tone mappers are bounded and monotonic', () => {
    let previousAces = -1
    let previousReinhard = -1
    for (let x = 0; x <= 8; x += 0.05) {
      const a = acesToneMap(x)
      const r = reinhardToneMap(x)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThanOrEqual(1)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(1)
      expect(a).toBeGreaterThanOrEqual(previousAces)
      expect(r).toBeGreaterThanOrEqual(previousReinhard)
      previousAces = a
      previousReinhard = r
    }
  })

  test('tone mappers are identity at zero', () => {
    expect(acesToneMap(0)).toBeCloseTo(0, 10)
    expect(reinhardToneMap(0)).toBeCloseTo(0, 10)
  })

  test('luminance weights green most heavily', () => {
    const green = luminance(hexToRgb('#00ff00'))
    const red = luminance(hexToRgb('#ff0000'))
    expect(green).toBeGreaterThan(red)
  })

  test('oklab mixing returns a plausible colour', () => {
    const mixed = mixOklab(hexToRgb('#000000'), hexToRgb('#ffffff'), 0.5)
    for (const channel of [mixed.r, mixed.g, mixed.b]) {
      expect(Number.isFinite(channel)).toBe(true)
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThan(1.5)
    }
    const back = rgbToHex(mixOklab(hexToRgb('#3c5c33'), hexToRgb('#3c5c33'), 0.5))
    expect(back).toBe('#3c5c33')
  })
})

describe('theme draft typing', () => {
  test('a draft may be sparse at every depth', () => {
    const draft: ThemeDraft = {
      name: 'sparse',
      terrain: { erosion: { rate: 0.1 } },
      lighting: { shadows: { steps: 10 } },
      rendering: { monochrome: { enabled: true } },
    }
    const theme = defineTheme(draft)
    expect(theme.name).toBe('sparse')
    expect(theme.terrain.erosion.rate).toBe(0.1)
    expect(theme.lighting.shadows.steps).toBe(10)
    expect(theme.rendering.monochrome.enabled).toBe(true)
  })
})
