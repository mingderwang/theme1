/**
 * A performance probe.
 *
 * Render time is the thing most likely to surprise someone, and it moves with
 * resolution, quality, which effects are enabled and how many workers there
 * are. Rather than guess, this measures it.
 *
 *   bun run bench
 *   bun run bench -- --theme dusk --width 1920 --height 1080
 */

import { availableParallelism } from 'node:os'
import { renderImage, type RenderImageResult } from '../render/cpu/renderImage.ts'
import { generateWorld } from '../world/worldGenerator.ts'
import { defineTheme } from '../theme/resolve.ts'
import { PRESETS } from '../theme/presets/index.ts'

interface Row {
  label: string
  generateMs: number
  renderMs: number
  rays: number
  workers: number
}

const megapixels = (rays: number): string => `${(rays / 1e6).toFixed(1)}M`

const timeIt = async (
  label: string,
  run: () => Promise<RenderImageResult>,
): Promise<Row> => {
  const result = await run()
  const { generationMs, renderMs, rays, workers } = result.stats
  const perMray = rays > 0 ? (renderMs / rays) * 1e6 : 0
  console.log(
    `  ${label.padEnd(30)} ${megapixels(rays).padStart(7)} rays  ` +
      `gen ${(generationMs / 1000).toFixed(2)}s  ` +
      `render ${(renderMs / 1000).toFixed(2).padStart(6)}s  ` +
      `${perMray.toFixed(0).padStart(5)} ms/Mray  ${workers} workers`,
  )
  return { label, generateMs: generationMs, renderMs, rays, workers }
}

const themeName = (() => {
  const index = Bun.argv.indexOf('--theme')
  return index >= 0 ? Bun.argv[index + 1] : undefined
})()

const preset = (themeName && PRESETS[themeName] ? themeName : 'alpine') as string
const draft = PRESETS[preset]!
const theme = defineTheme({ ...draft, name: preset })
const seed = 42
const workers = Math.max(1, availableParallelism())

console.log(`theme ${preset}, seed ${seed}, ${workers} workers, terrain ${theme.terrain.resolution}^2\n`)

console.log('generation only')
{
  const samples: number[] = []
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now()
    generateWorld({ seed, theme })
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b) => a - b)
  console.log(`  median ${(samples[1]! / 1000).toFixed(2)}s of ${samples.map((s) => (s / 1000).toFixed(2)).join('s, ')}s`)
}

console.log('\nresolution and quality')
for (const [w, h, quality] of [
  [480, 270, 'preview'],
  [960, 540, 'standard'],
  [1280, 720, 'standard'],
  [1920, 1080, 'standard'],
  [1920, 1080, 'high'],
] as const) {
  await timeIt(`${w}x${h} ${quality}`, () =>
    renderImage({ seed, theme, width: w, height: h, quality, workers }),
  )
}

console.log('\nwhat each effect costs (960x540, standard)')
{
  const base = { seed, theme, width: 960, height: 540, quality: 'standard' as const, workers }
  await timeIt('everything on', () => renderImage(base))
  await timeIt('no clouds', () => renderImage({ ...base, theme: defineTheme({ ...draft, name: preset, cloud: { enabled: false } }) }))
  await timeIt('no water', () => renderImage({ ...base, theme: defineTheme({ ...draft, name: preset, water: { enabled: false } }) }))
  await timeIt('no shadows', () =>
    renderImage({ ...base, theme: defineTheme({ ...draft, name: preset, lighting: { shadows: { enabled: false } } }) }),
  )
  await timeIt('no water reflections', () =>
    renderImage({ ...base, theme: defineTheme({ ...draft, name: preset, water: { reflections: false } }) }),
  )
}

console.log('\nworker scaling (1280x720, standard)')
for (const count of [1, 2, 4, workers]) {
  if (count > workers) continue
  await timeIt(`${count} worker${count === 1 ? '' : 's'}`, () =>
    renderImage({ seed, theme, width: 1280, height: 720, quality: 'standard', workers: count }),
  )
}
