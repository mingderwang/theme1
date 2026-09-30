/**
 * Worker entry point.
 *
 * The world is sent once at init; afterwards the parent only sends row
 * ranges. Because a tile writes only into its own rows, the result does not
 * depend on how the work was distributed.
 */

import { parentPort, workerData } from 'node:worker_threads'
import { Camera } from '../common/camera.ts'
import type { CameraSpec } from '../common/camera.ts'
import { createRenderContext } from './context.ts'
import { renderTileRows } from './tile.ts'
import type { World } from '../../world/types.ts'

export interface WorkerInit {
  world: World
  width: number
  height: number
  time: number
  camera: CameraSpec
}

export interface WorkerTask {
  y0: number
  y1: number
}

export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'done'; y0: number; y1: number; data: Float32Array }

const port = parentPort
if (port) {
  const init = workerData as WorkerInit
  const ctx = createRenderContext(init.world, init.time)
  ctx.viewX = init.camera.position.x
  ctx.viewY = init.camera.position.y
  ctx.viewZ = init.camera.position.z
  const camera = new Camera(init.camera, init.width, init.height)

  port.on('message', (task: WorkerTask) => {
    const rows = task.y1 - task.y0
    const data = new Float32Array(init.width * rows * 3)
    renderTileRows(ctx, camera, init.width, init.height, task.y0, task.y1, data)
    port.postMessage({ type: 'done', y0: task.y0, y1: task.y1, data }, [data.buffer])
  })

  port.postMessage({ type: 'ready' })
}
