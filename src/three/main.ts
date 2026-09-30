/**
 * Browser entry point for the viewer.
 *
 * Bundled with `bun run viewer:build`, which produces public/main.js with
 * three bundled in, so the page needs no network access and no import map.
 *
 * Query parameters:
 *   ?seed=42&theme=alpine&res=768&animate=1
 */

import { generateWorld } from '../world/worldGenerator.ts'
import { defineTheme } from '../theme/resolve.ts'
import { PRESETS, DEFAULT_PRESET_NAME } from '../theme/presets/index.ts'
import { createViewer } from '../render/three/viewer.ts'
import type { ThemeDraft } from '../theme/types.ts'

/**
 * Heightfield resolution used by the viewer, whatever the preset asks for.
 *
 * The mesh is built at `segmentSize` metres, so a 768² field over a 4km tile
 * is already finer than the geometry the GPU can resolve. Using the preset's
 * own 1536² costs roughly four times as much for detail nothing shows, and it
 * blocks the main thread while it runs.
 */
const DEFAULT_VIEWER_RESOLUTION = 768
const MAX_VIEWER_RESOLUTION = 1024

const container = document.getElementById('view')
const status = document.getElementById('status')
const themeSelect = document.getElementById('theme') as HTMLSelectElement | null
const seedInput = document.getElementById('seed') as HTMLInputElement | null

const params = new URLSearchParams(globalThis.location.search)
const readNumber = (key: string, fallback: number): number => {
  const raw = params.get(key)
  const value = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(value) ? value : fallback
}

let seed = readNumber('seed', 42)
let themeName = params.get('theme') ?? DEFAULT_PRESET_NAME
const animate = params.get('animate') === '1'
const resolution = Math.max(
  64,
  Math.min(MAX_VIEWER_RESOLUTION, readNumber('res', DEFAULT_VIEWER_RESOLUTION)),
)

if (!PRESETS[themeName]) themeName = DEFAULT_PRESET_NAME

for (const name of Object.keys(PRESETS)) {
  const option = document.createElement('option')
  option.value = name
  option.textContent = name
  option.selected = name === themeName
  themeSelect?.appendChild(option)
}

let current: { dispose(): void } | null = null

const build = async (): Promise<void> => {
  if (!container) return
  if (status) status.textContent = 'generating terrain...'

  const started = performance.now()
  const draft: ThemeDraft = { ...PRESETS[themeName]!, name: themeName }
  draft.terrain = { ...draft.terrain, resolution }

  // Yield long enough for the status text to paint before the synchronous
  // generation starts and freezes the tab.
  await new Promise((resolve) => setTimeout(resolve, 30))

  const theme = defineTheme(draft)
  const world = generateWorld({ seed, theme })
  const generated = performance.now()

  current?.dispose()
  container.innerHTML = ''

  current = await createViewer(container, world, { animate, segmentSize: 6 })
  if (status) {
    const terrain = world.terrain
    status.textContent =
      `seed ${seed} · ${themeName} · ${terrain.resolution}² heightfield ` +
      `(${terrain.stride}² samples) · relief ${terrain.minHeight.toFixed(0)}..${terrain.maxHeight.toFixed(0)} m · ` +
      `${terrain.hasWater ? `water at ${terrain.waterLevel.toFixed(0)} m` : 'no water'} · ` +
      `generated in ${(generated - started).toFixed(0)} ms`
  }
}

themeSelect?.addEventListener('change', () => {
  themeName = themeSelect.value
  void build()
})
seedInput?.addEventListener('change', () => {
  const value = Number(seedInput.value)
  if (Number.isFinite(value)) {
    seed = value
    void build()
  }
})
globalThis.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'r' || event.key === 'R') {
    seed = (seed + 1) % 100000
    if (seedInput) seedInput.value = String(seed)
    void build()
  }
})

void build()
