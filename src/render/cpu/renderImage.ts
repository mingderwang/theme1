/**
 * Renders a world to a linear-light framebuffer, then grades it to sRGB bytes.
 *
 * `renderImage` is the whole CPU pipeline:
 *   world -> camera -> tiles (parallel) -> tone map -> bytes
 */

import { availableParallelism } from 'node:os'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Worker } from 'node:worker_threads'
import { Camera, type CameraSpec } from '../common/camera.ts'
import { composeCamera, type CameraPreset } from '../common/cameraPresets.ts'
import { present } from '../common/colorPipeline.ts'
import { defineTheme, clampQuality, withQuality } from '../../theme/resolve.ts'
import type { ThemeDraft, WorldTheme } from '../../theme/types.ts'
import { generateWorld } from '../../world/worldGenerator.ts'
import type { World } from '../../world/types.ts'
import { createRenderContext } from './context.ts'
import { buildTileRanges, renderTileRows } from './tile.ts'
import { encodePng } from '../png/encoder.ts'
import type { WorkerInit, WorkerTask } from './worker.ts'

export interface RenderImageOptions {
  seed?: number
  /** A fully resolved theme. Takes precedence over `themeDraft`. */
  theme?: WorldTheme
  themeDraft?: ThemeDraft
  /** Reuse an existing world instead of generating one. */
  world?: World
  width?: number
  height?: number
  /** Seconds of world time; drives waves and cloud drift. Never the clock. */
  time?: number
  camera?: CameraSpec | CameraPreset
  fovY?: number
  quality?: 'preview' | 'standard' | 'high'
  /** Override the worker count. 0 or 1 renders on the calling thread. */
  workers?: number
  onProgress?: (fraction: number, label: string) => void
}

export interface RenderImageResult {
  width: number
  height: number
  /** sRGB bytes, three per pixel. */
  pixels: Uint8Array
  /** The linear framebuffer, kept for callers that want to grade differently. */
  linear: Float32Array
  world: World
  camera: CameraSpec
  stats: {
    generationMs: number
    renderMs: number
    presentMs: number
    totalMs: number
    tiles: number
    workers: number
    rays: number
  }
}

const resolveTheme = (options: RenderImageOptions): WorldTheme => {
  const quality = options.quality
  if (options.theme) {
    // A pre-resolved theme still honours an explicit quality request.
    return quality ? withQuality(options.theme, clampQuality(quality)) : options.theme
  }
  const draft: ThemeDraft = { ...options.themeDraft }
  if (quality) draft.rendering = { ...draft.rendering, quality: clampQuality(quality) }
  if (options.width) draft.rendering = { ...draft.rendering, width: options.width }
  if (options.height) draft.rendering = { ...draft.rendering, height: options.height }
  return defineTheme(draft)
}

const defaultWorkerCount = (): number => {
  try {
    return Math.max(1, availableParallelism())
  } catch {
    return 4
  }
}

interface PooledRender {
  linear: Float32Array
  tiles: number
  workers: number
}

const renderSerial = (
  ctx: ReturnType<typeof createRenderContext>,
  camera: Camera,
  width: number,
  height: number,
  ranges: { y0: number; y1: number }[],
  onProgress?: (fraction: number, label: string) => void,
): Float32Array => {
  const linear = new Float32Array(width * height * 3)
  let done = 0
  for (const range of ranges) {
    const rows = range.y1 - range.y0
    const band = new Float32Array(width * rows * 3)
    renderTileRows(ctx, camera, width, height, range.y0, range.y1, band)
    linear.set(band, range.y0 * width * 3)
    done += rows
    onProgress?.(done / height, 'render')
  }
  return linear
}

const renderPooled = async (
  init: WorkerInit,
  width: number,
  height: number,
  ranges: { y0: number; y1: number }[],
  workerCount: number,
  onProgress?: (fraction: number, label: string) => void,
): Promise<Float32Array> => {
  const linear = new Float32Array(width * height * 3)
  const workers: Worker[] = []
  let next = 0
  let completedRows = 0
  let settled = false

  const finish = (): void => {
    if (settled) return
    settled = true
    for (const worker of workers) void worker.terminate()
  }

  try {
    const pending = new Promise<void>((resolve, reject) => {
      for (let i = 0; i < workerCount; i++) {
        const worker = new Worker(new URL('./worker.ts', import.meta.url).href, {
          workerData: init,
        })
        workers.push(worker)

        worker.on('message', (message: { type: string; y0: number; y1: number; data: Float32Array }) => {
          if (message.type !== 'done') return
          const rows = message.y1 - message.y0
          linear.set(message.data, message.y0 * width * 3)
          completedRows += rows
          onProgress?.(completedRows / height, 'render')

          if (next < ranges.length) {
            const range = ranges[next++]!
            const task: WorkerTask = { y0: range.y0, y1: range.y1 }
            worker.postMessage(task)
          } else {
            worker.unref()
          }
          if (completedRows >= height) {
            finish()
            resolve()
          }
        })

        worker.on('error', (error) => {
          if (settled) return
          settled = true
          reject(error)
        })

        // Prime each worker with one tile.
        if (next < ranges.length) {
          const range = ranges[next++]!
          const task: WorkerTask = { y0: range.y0, y1: range.y1 }
          worker.postMessage(task)
        }
      }

      if (ranges.length === 0) {
        finish()
        resolve()
      }
    })

    await pending
  } catch (error) {
    finish()
    throw error
  }

  return linear
}

export const renderImage = async (options: RenderImageOptions = {}): Promise<RenderImageResult> => {
  const started = performance.now()
  const theme = resolveTheme(options)
  const world = options.world ?? generateWorld({ seed: options.seed, theme })
  const afterGeneration = performance.now()

  const width = options.width ?? theme.rendering.width
  const height = options.height ?? theme.rendering.height

  const fovOverride = options.fovY !== undefined ? options.fovY : undefined
  let cameraSpec: CameraSpec
  if (typeof options.camera === 'object' && options.camera !== null) {
    // CameraSpec.fovY is in degrees.
    cameraSpec = {
      ...options.camera,
      fovY: options.camera.fovY ?? fovOverride ?? 48,
    }
  } else {
    const composed = composeCamera(world, options.camera ?? 'auto')
    cameraSpec = {
      position: composed.position,
      target: composed.target,
      fovY: fovOverride ?? composed.fovY,
    }
  }

  const camera = new Camera(cameraSpec, width, height)
  const ctx = createRenderContext(world, options.time ?? 0)
  ctx.viewX = cameraSpec.position.x
  ctx.viewY = cameraSpec.position.y
  ctx.viewZ = cameraSpec.position.z

  const requested = options.workers ?? defaultWorkerCount()
  const workers = Math.max(0, Math.min(requested, 32))
  const ranges = buildTileRanges(height, workers)
  const usePool = workers > 1 && ranges.length > 1

  let linear: Float32Array
  let usedWorkers: number

  if (usePool) {
    const init: WorkerInit = {
      world,
      width,
      height,
      time: options.time ?? 0,
      camera: cameraSpec,
    }
    try {
      linear = await renderPooled(init, width, height, ranges, workers, options.onProgress)
      usedWorkers = workers
    } catch (error) {
      // Workers are an optimization, never a requirement.
      options.onProgress?.(0, 'workers failed, falling back to one thread')
      linear = renderSerial(ctx, camera, width, height, ranges, options.onProgress)
      usedWorkers = 1
      void error
    }
  } else {
    linear = renderSerial(ctx, camera, width, height, ranges, options.onProgress)
    usedWorkers = 1
  }

  const afterRender = performance.now()
  const pixels = new Uint8Array(width * height * 3)
  present(linear, {
    width,
    height,
    exposure: theme.rendering.exposure,
    toneMapping: theme.rendering.toneMapping,
    saturation: theme.rendering.saturation,
    vignette: theme.rendering.vignette,
    grain: theme.rendering.grain,
    monochrome: theme.rendering.monochrome,
  }, pixels)
  const done = performance.now()

  const samples = Math.max(1, Math.round(theme.rendering.supersampling)) ** 2

  return {
    width,
    height,
    pixels,
    linear,
    world,
    camera: cameraSpec,
    stats: {
      generationMs: world.stats.generationMs,
      renderMs: afterRender - afterGeneration,
      presentMs: done - afterRender,
      totalMs: done - started,
      tiles: ranges.length,
      workers: usedWorkers,
      rays: width * height * samples,
    },
  }
}

export const renderToPngBytes = async (options: RenderImageOptions = {}): Promise<Uint8Array> => {
  const image = await renderImage(options)
  return encodePng(image.width, image.height, image.pixels)
}

export interface WritePngResult extends RenderImageResult {
  path: string
}

export const renderToPng = async (
  path: string,
  options: RenderImageOptions = {},
): Promise<WritePngResult> => {
  const image = await renderImage(options)
  const png = encodePng(image.width, image.height, image.pixels)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, png)
  return { ...image, path }
}
