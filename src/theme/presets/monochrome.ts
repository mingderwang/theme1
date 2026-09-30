import type { ThemeDraft } from '../types.ts'
import { alpine } from './alpine.ts'

/** The alpine range rendered as a black and white photograph. */
export const monochrome: ThemeDraft = {
  ...alpine,
  name: 'monochrome',
  cloud: {
    ...alpine.cloud,
    coverage: 0.55,
    density: 1.15,
  },
  lighting: {
    ...alpine.lighting,
    sunDirection: { x: 0.68, y: 0.46, z: -0.57 },
    sunIntensity: 3.6,
    ambientIntensity: 0.42,
  },
  rendering: {
    monochrome: {
      enabled: true,
      contrast: 1.28,
      lift: 0.015,
      gain: 1.08,
      tint: '#f6f4f0',
    },
    saturation: 0,
    vignette: 0.34,
    grain: 0.03,
  },
}
