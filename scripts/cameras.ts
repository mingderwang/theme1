/**
 * Camera scorer diagnostic.
 *
 * Prints the candidate viewpoints a preset generates with each score component,
 * so framing problems can be diagnosed rather than guessed at.
 *
 *   bun run scripts/cameras.ts alpine 7
 */

import { generateWorld } from '../src/world/worldGenerator.ts'
import { defineTheme } from '../src/theme/resolve.ts'
import { PRESETS } from '../src/theme/presets/index.ts'
import { composeCamera, inspectCamera } from '../src/render/common/cameraPresets.ts'
import { heightAt } from '../src/world/terrain/sample.ts'
import type { World } from '../src/world/types.ts'

const name = process.argv[2] ?? 'alpine'
const seed = Number(process.argv[3] ?? 7)
const top = Number(process.argv[4] ?? 8)
const draft = PRESETS[name]
if (!draft) throw new Error(`unknown theme ${name}`)

const theme = defineTheme({ ...draft, name })
const world: World = generateWorld({ seed, theme })
const field = world.terrain
const waterLevel = field.hasWater ? field.waterLevel : field.minHeight
const reliefScale = field.maxHeight - waterLevel

console.log(
  `theme ${name} seed ${seed}\n` +
    `relief ${field.minHeight.toFixed(0)}..${field.maxHeight.toFixed(0)}m  water ${waterLevel.toFixed(0)}m  ` +
    `reliefScale ${reliefScale.toFixed(0)}m  size ${field.size}m\n`,
)

const composed = composeCamera(world, 'auto')
console.log(
  `chosen: preset=${composed.preset} score=${composed.score.toFixed(2)} ` +
    `eye ${composed.position.x.toFixed(0)},${composed.position.y.toFixed(0)},${composed.position.z.toFixed(0)} ` +
    `(ground ${heightAt(field, composed.position.x, composed.position.z).toFixed(0)}) ` +
    `depression ${composed.depression.toFixed(1)}deg fov ${composed.fovY}\n`,
)

const ranked = inspectCamera(world, composed.preset).sort((a, b) => b.score.total - a.score.total)
console.log(`candidates generated: ${ranked.length}\n`)
console.log(
  '  rank  score  relief  occl  block  water  off   light   dep   dist   eye                            depression  fov',
)
for (let i = 0; i < Math.min(top, ranked.length); i++) {
  const { candidate, score } = ranked[i]!
  const mark = i === 0 ? '->' : '  '
  console.log(
    `${mark} ${String(i + 1).padStart(4)} ` +
      `${score.total.toFixed(2).padStart(6)} ` +
      `${score.relief.toFixed(2).padStart(6)} ` +
      `${score.occlusion.toFixed(2).padStart(5)} ` +
      `${score.blocked.toFixed(2).padStart(5)} ` +
      `${score.water.toFixed(2).padStart(5)} ` +
      `${score.offTile.toFixed(2).padStart(4)} ` +
      `${score.crossLight.toFixed(2).padStart(5)} ` +
      `${score.depression.toFixed(2).padStart(5)} ` +
      `${score.distance.toFixed(2).padStart(5)}  ` +
      `${candidate.eye.x.toFixed(0).padStart(6)},${candidate.eye.y.toFixed(0).padStart(5)},${candidate.eye.z.toFixed(0).padStart(6)}` +
      `  ${candidate.depression.toFixed(0).padStart(9)}  ${candidate.fovY}`,
  )
}
