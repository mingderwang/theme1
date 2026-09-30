import type { ThemeDraft } from '../types.ts'

/** Dry dune sea and mesas: high sun, dust haze, almost no water. */
export const desert: ThemeDraft = {
  name: 'desert',
  terrain: {
    worldSize: 3000,
    resolution: 1024,
    amplitude: 430,
    featureSize: 620,
    octaves: 9,
    lacunarity: 2.11,
    ridgedMix: 0.18,
    ridgeSharpness: 1.6,
    warpStrength: 0.7,
    warpFrequency: 0.9,
    shapeFeatureSize: 5000,
    seaThreshold: 0.1,
    coastSoftness: 0.14,
    seaDepth: 24,
    waterFraction: 0.04,
    erosion: { enabled: false, iterations: 0, talusAngle: 42, rate: 0.2 },
    moisture: { frequency: 3.2, seaInfluence: 0.04, runoff: 0.12, contrast: 2.4 },
    climate: { seaLevelTemperature: 38, lapseRate: 0.0055, variation: 6 },
  },
  water: { enabled: false, turbidity: 0.12 },
  cloud: {
    coverage: 0.22,
    baseAltitude: 2400,
    topAltitude: 3400,
    featureSize: 4600,
    density: 0.5,
    anisotropy: 0.5,
    litColor: '#fffaf2',
    shadowColor: '#c8b39a',
  },
  sky: {
    zenithColor: '#3f7fc4',
    horizonColor: '#e6d4b4',
    turbidity: 0.85,
    mie: 0.9,
    sunGlow: 1.2,
  },
  atmosphere: {
    fogDensity: 0.0002,
    fogHeight: 1500,
    fogColor: '#e3cdae',
    sunScatter: 0.75,
  },
  lighting: {
    sunDirection: { x: 0.36, y: 0.55, z: -0.76 },
    sunColor: '#fff2d6',
    sunIntensity: 4.2,
    ambientSkyColor: '#bcd6f2',
    ambientGroundColor: '#8a6a44',
    ambientIntensity: 0.62,
  },
  palette: {
    // The whole palette is sand, so the only thing that can give the image
    // tonal range is the slope mask: bright sand on the flats, dark rock on
    // the dune slip faces. Rock and dry must differ in value, not just hue.
    dryColor: '#d9bd8a',
    grassColor: '#c19a5f',
    forestColor: '#a87f4c',
    rockColor: '#7e4c33',
    highlandColor: '#b07f52',
    snowColor: '#efe0c6',
    sandColor: '#e2cb9c',
    underwaterColor: '#6b5a3f',
    // Nothing grows here, so the treeline is out of range and the rock mask
    // is driven by the desert's own rock and sand colors.
    treeLine: 100000,
    treeLineBlend: 1000,
    snowLine: 100000,
    snowBlend: 1000,
    rockSlope: 0.42,
    snowSlope: 1.2,
    variation: 0.3,
    variationColor: '#9c6a3c',
  },
}
