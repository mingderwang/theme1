#!/usr/bin/env bun
/**
 * Command line entry point.
 *
 *   bun run render -- --seed 42 --theme alpine --out renders/alpine-42.png
 *   bun run render -- themes
 *   bun run render -- batch --theme desert --seeds 1 2 3
 */

import { resolve, join } from 'node:path'
import { renderToPng } from '../render/cpu/renderImage.ts'
import { DEFAULT_THEME, defineTheme, validateTheme } from '../theme/resolve.ts'
import { DEFAULT_PRESET_NAME, PRESETS } from '../theme/presets/index.ts'
import type { ThemeDraft, WorldTheme } from '../theme/types.ts'
import type { CameraPreset } from '../render/common/cameraPresets.ts'

/** Sun elevation above the horizon, in degrees. */
const sunElevation = (theme: WorldTheme): number => {
  const d = theme.lighting.sunDirection
  return (Math.asin(Math.max(-1, Math.min(1, d.y))) * 180) / Math.PI
}

interface Args {
  command: string
  /** Repeated flags collect into an array. */
  flags: Map<string, string | string[] | true>
  positional: string[]
}

const parseArgs = (argv: string[]): Args => {
  const flags = new Map<string, string | string[] | true>()
  const positional: string[] = []
  let command = 'render'

  const set = (key: string, value: string): void => {
    const existing = flags.get(key)
    if (existing === undefined) {
      flags.set(key, value)
    } else if (existing === true) {
      flags.set(key, value)
    } else if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      flags.set(key, [existing, value])
    }
  }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!
    if (token.startsWith('--')) {
      const body = token.slice(2)
      const eq = body.indexOf('=')
      if (eq >= 0) {
        set(body.slice(0, eq), body.slice(eq + 1))
      } else {
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('--')) {
          set(body, next)
          i++
        } else {
          flags.set(body, true)
        }
      }
    } else if (command === 'render' && positional.length === 0) {
      command = token
    } else {
      positional.push(token)
    }
  }

  return { command, flags, positional }
}

const num = (args: Args, key: string): number | undefined => {
  const value = args.flags.get(key)
  if (value === undefined || value === true) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const str = (args: Args, key: string): string | undefined => {
  const value = args.flags.get(key)
  if (value === undefined || value === true) return undefined
  return Array.isArray(value) ? value[value.length - 1] : value
}

const many = (args: Args, key: string): string[] => {
  const value = args.flags.get(key)
  if (value === undefined || value === true) return []
  return Array.isArray(value) ? value : [value]
}

const bool = (args: Args, key: string): boolean | undefined => {
  const value = args.flags.get(key)
  if (value === undefined) return undefined
  if (value === true) return true
  const last = Array.isArray(value) ? value[value.length - 1] : value
  return last !== 'false' && last !== '0' && last !== 'no'
}

const HELP = `
theme1 - procedural 3D environment images

Usage
  bun run render -- [options]            render one image
  bun run render -- themes               list the theme presets
  bun run render -- batch --seeds 1 2 3  render several seeds
  bun run render -- validate <name>      check a theme and print warnings

Options
  --seed <n>          world seed (default ${DEFAULT_THEME.seed})
  --theme <name>      preset name (default ${DEFAULT_PRESET_NAME})
  --out <path>        output PNG (default renders/<theme>-<seed>.png)
  --width <n>         image width in pixels
  --height <n>        image height in pixels
  --quality <q>       preview | standard | high
  --camera <preset>   auto | aerial | vista | ground | closeup
  --fov <deg>         override the field of view
  --time <s>          world time in seconds (waves, cloud drift)
  --workers <n>       worker threads, 1 disables the pool
  --no-water          disable the water surface
  --no-clouds         disable the cloud volume
  --no-shadows        disable sun shadows
  --no-reflections    disable water reflections
  --resolution <n>    terrain grid resolution
  --monochrome        force the monochrome look
  --set <path=value>  override any theme field, repeatable
  --quiet             only print the output path
`

/** Apply `--set a.b.c=value` overrides onto a draft. Values are parsed as JSON
 *  when possible, so numbers, booleans, arrays and null all work. */
const applyOverrides = (draft: ThemeDraft, args: Args): ThemeDraft => {
  const overrides = many(args, 'set')
  for (const entry of args.positional) {
    if (entry.includes('=')) overrides.push(entry)
  }
  if (overrides.length === 0) return draft

  const result = draft as unknown as Record<string, unknown>
  for (const override of overrides) {
    const eq = override.indexOf('=')
    if (eq <= 0) throw new Error(`--set expects path=value, received "${override}"`)
    const path = override.slice(0, eq).split('.')
    const raw = override.slice(eq + 1)
    let parsed: unknown = raw
    try {
      parsed = JSON.parse(raw)
    } catch {
      // keep the string
    }
    let node = result
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i]!
      const next = node[key]
      if (typeof next !== 'object' || next === null) node[key] = {}
      node = node[key] as Record<string, unknown>
    }
    node[path[path.length - 1]!] = parsed
  }
  return draft
}

const buildTheme = (args: Args): WorldTheme => {
  const name = str(args, 'theme') ?? DEFAULT_PRESET_NAME
  const preset = PRESETS[name]
  if (!preset) {
    const known = Object.keys(PRESETS).join(', ')
    throw new Error(`Unknown theme "${name}". Available: ${known}`)
  }

  let draft: ThemeDraft = { ...preset, name }
  const seed = num(args, 'seed')
  if (seed !== undefined) draft.seed = seed

  const width = num(args, 'width')
  const height = num(args, 'height')
  const quality = str(args, 'quality')
  const resolution = num(args, 'resolution')

  draft.rendering = {
    ...draft.rendering,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(quality ? { quality: quality as 'preview' | 'standard' | 'high' } : {}),
  }
  if (resolution !== undefined) {
    draft.terrain = { ...draft.terrain, resolution }
  }

  if (bool(args, 'no-water') === true) {
    draft.water = { ...draft.water, enabled: false }
  }
  if (bool(args, 'no-clouds') === true) {
    draft.cloud = { ...draft.cloud, enabled: false }
  }
  if (bool(args, 'no-shadows') === true) {
    draft.lighting = {
      ...draft.lighting,
      shadows: { ...preset.lighting?.shadows, enabled: false },
    }
  }
  if (bool(args, 'no-reflections') === true) {
    draft.water = { ...draft.water, reflections: false }
  }
  if (bool(args, 'monochrome') === true) {
    draft.rendering = {
      ...draft.rendering,
      monochrome: { ...DEFAULT_THEME.rendering.monochrome, enabled: true },
    }
  }

  draft = applyOverrides(draft, args)
  return defineTheme(draft)
}

const describe = (result: Awaited<ReturnType<typeof renderToPng>>, quiet: boolean): void => {
  if (quiet) {
    console.log(result.path)
    return
  }
  const s = result.stats
  const world = result.world
  console.log(`${result.path}`)
  console.log(
    `  ${result.width}x${result.height}  ${(s.rays / 1e6).toFixed(2)}M rays  ` +
      `${s.workers} worker${s.workers === 1 ? '' : 's'}  ${s.tiles} tiles`,
  )
  console.log(
    `  generate ${(s.generationMs / 1000).toFixed(2)}s   ` +
      `render ${(s.renderMs / 1000).toFixed(2)}s   ` +
      `present ${(s.presentMs / 1000).toFixed(2)}s   ` +
      `total ${(s.totalMs / 1000).toFixed(2)}s`,
  )
  console.log(
    `  terrain ${world.terrain.minHeight.toFixed(0)}..${world.terrain.maxHeight.toFixed(0)}m   ` +
      `water ${world.terrain.hasWater ? `${world.terrain.waterLevel.toFixed(0)}m (${(world.water.coverage * 100).toFixed(0)}%)` : 'none'}`,
  )
  console.log(
    `  camera ${result.camera.position.x.toFixed(0)},${result.camera.position.y.toFixed(0)},${result.camera.position.z.toFixed(0)} ` +
      `-> ${result.camera.target.x.toFixed(0)},${result.camera.target.y.toFixed(0)},${result.camera.target.z.toFixed(0)} ` +
      `fov ${result.camera.fovY.toFixed(0)}`,
  )
}

const listThemes = (): void => {
  console.log('Theme presets\n')
  for (const [name, draft] of Object.entries(PRESETS)) {
    const theme = defineTheme({ ...draft, name })
    const { warnings } = validateTheme(theme)
    const water = theme.water.enabled ? `${(theme.terrain.waterFraction * 100).toFixed(0)}%` : 'none'
    console.log(
      `  ${name.padEnd(12)} ${String(theme.terrain.resolution).padStart(5)} cells   ` +
        `amplitude ${theme.terrain.amplitude.toFixed(0).padStart(4)}m   ` +
        `water ${water.padStart(4)}   ` +
        `clouds ${(theme.cloud.coverage * 100).toFixed(0).padStart(3)}%   ` +
        `sun ${theme.lighting.sunColor} at ${sunElevation(theme).toFixed(0)}deg`,
    )
    for (const warning of warnings) console.log(`      warning: ${warning}`)
  }
  console.log('\nPass --theme <name> to render, or define your own with defineTheme().')
}

const main = async (): Promise<void> => {
  const args = parseArgs(Bun.argv.slice(2))

  if (args.flags.has('help') || args.command === 'help') {
    console.log(HELP)
    return
  }

  if (args.command === 'themes') {
    listThemes()
    return
  }

  if (args.command === 'validate') {
    const name = args.positional[0]
    if (!name) {
      console.error('usage: render validate <theme>')
      process.exitCode = 1
      return
    }
    const theme = buildTheme({
      ...args,
      flags: new Map([...args.flags].filter(([k]) => k !== 'theme')),
    })
    const { errors, warnings } = validateTheme(theme)
    for (const error of errors) console.log(`error: ${error}`)
    for (const warning of warnings) console.log(`warning: ${warning}`)
    console.log(errors.length === 0 ? `theme "${theme.name}" is valid` : `${errors.length} error(s)`)
    process.exitCode = errors.length === 0 ? 0 : 1
    return
  }

  if (args.command === 'batch') {
    const seeds = args.positional.length > 0 ? args.positional.map(Number) : [1, 2, 3, 4]
    const outDir = str(args, 'out') ?? 'renders'
    const quiet = bool(args, 'quiet') === true
    for (const seed of seeds) {
      const result = await renderToPng(join(outDir, `${str(args, 'theme') ?? DEFAULT_PRESET_NAME}-${seed}.png`), {
        seed,
        theme: buildTheme(args),
        camera: (str(args, 'camera') as CameraPreset) ?? 'auto',
        quality: str(args, 'quality') as 'preview' | 'standard' | 'high' | undefined,
        width: num(args, 'width'),
        height: num(args, 'height'),
        time: num(args, 'time') ?? 0,
        workers: num(args, 'workers'),
      })
      describe(result, quiet)
    }
    return
  }

  const theme = buildTheme(args)
  const seed = num(args, 'seed') ?? theme.seed
  const out = str(args, 'out') ?? `renders/${theme.name}-${seed}.png`

  let lastTick = 0
  const result = await renderToPng(resolve(out), {
    seed,
    theme,
    camera: (str(args, 'camera') as CameraPreset) ?? 'auto',
    fovY: num(args, 'fov'),
    time: num(args, 'time') ?? 0,
    workers: num(args, 'workers'),
    onProgress:
      bool(args, 'quiet') === true
        ? undefined
        : (fraction, label) => {
            const now = performance.now()
            if (now - lastTick < 200 && fraction < 1) return
            lastTick = now
            const width = 28
            const filled = Math.round(fraction * width)
            process.stdout.write(
              `\r  ${label} [${'#'.repeat(filled)}${'.'.repeat(width - filled)}] ${(fraction * 100).toFixed(0).padStart(3)}%`,
            )
            if (fraction >= 1) process.stdout.write('\n')
          },
  })

  describe(result, bool(args, 'quiet') === true)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
