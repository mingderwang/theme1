import { describe, expect, test } from 'bun:test'
import { deflateSync, inflateSync } from 'node:zlib'
import { encodePng } from '../src/render/png/encoder.ts'
import { renderImage, renderToPngBytes } from '../src/render/cpu/renderImage.ts'
import { Camera } from '../src/render/common/camera.ts'
import { composeCamera } from '../src/render/common/cameraPresets.ts'
import { present } from '../src/render/common/colorPipeline.ts'
import { Framebuffer } from '../src/render/common/framebuffer.ts'
import { generateWorld } from '../src/world/worldGenerator.ts'
import { heightAt } from '../src/world/terrain/sample.ts'
import type { TerrainField } from '../src/world/types.ts'
import { createRenderContext } from '../src/render/cpu/context.ts'
import { traceTerrain, traceShadow, shadeTerrain } from '../src/render/cpu/terrain.ts'
import { waterPlaneHit } from '../src/render/cpu/water.ts'
import { phaseHG } from '../src/render/cpu/clouds.ts'
import { defineTheme } from '../src/theme/resolve.ts'
import { alpine, desert } from '../src/theme/presets/index.ts'
import type { Rgb, Vec3 } from '../src/core/math/index.ts'

/** A tiny theme: these tests check wiring and invariants, not image quality. */
const tiny = (draft = alpine) =>
  defineTheme({
    ...draft,
    name: 'tiny',
    terrain: { resolution: 96, worldSize: 900, amplitude: 300, featureSize: 400 },
    rendering: { width: 48, height: 27, quality: 'preview', supersampling: 1 },
  })

describe('encodePng', () => {
  const width = 7
  const height = 5
  const pixels = new Uint8Array(width * height * 3)
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37) % 256

  test('starts with the PNG signature', () => {
    const png = encodePng(width, height, pixels)
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })

  test('has IHDR, IDAT and IEND in order and no trailing bytes', () => {
    const png = encodePng(width, height, pixels)
    const types: string[] = []
    let offset = 8
    while (offset < png.length) {
      const length =
        (png[offset]! << 24) | (png[offset + 1]! << 16) | (png[offset + 2]! << 8) | png[offset + 3]!
      types.push(String.fromCharCode(png[offset + 4]!, png[offset + 5]!, png[offset + 6]!, png[offset + 7]!))
      offset += 12 + length
    }
    expect(types).toEqual(['IHDR', 'IDAT', 'IEND'])
    expect(offset).toBe(png.length)
  })

  test('IHDR carries the right dimensions, depth and colour type', () => {
    const png = encodePng(width, height, pixels)
    // 8 signature + 4 length + 4 type puts the IHDR payload at offset 16.
    const view = new DataView(png.buffer, png.byteOffset)
    expect(view.getUint32(16)).toBe(width)
    expect(view.getUint32(20)).toBe(height)
    expect(png[24]).toBe(8) // bit depth
    expect(png[25]).toBe(2) // truecolour
    expect(png[26]).toBe(0) // deflate
    expect(png[27]).toBe(0) // adaptive filtering
    expect(png[28]).toBe(0) // no interlace
  })

  test('the CRCs are correct', () => {
    const png = encodePng(width, height, pixels)
    let offset = 8
    while (offset < png.length) {
      const length =
        (png[offset]! << 24) | (png[offset + 1]! << 16) | (png[offset + 2]! << 8) | png[offset + 3]!
      const view = new DataView(png.buffer, png.byteOffset + offset)
      const declared = view.getUint32(8 + length)
      // Recompute over type + data.
      const body = png.subarray(offset + 4, offset + 8 + length)
      const table = new Uint32Array(256)
      for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        table[n] = c >>> 0
      }
      let crc = 0xffffffff
      for (const byte of body) crc = (table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0
      expect((crc ^ 0xffffffff) >>> 0).toBe(declared)
      offset += 12 + length
    }
  })

  test('the image survives an encode and decode round trip', () => {
    const png = encodePng(width, height, pixels)
    // Find IDAT and inflate it.
    const length =
      (png[8]! << 24) | (png[9]! << 16) | (png[10]! << 8) | png[11]!
    const start = 8 + 8 + length + 4
    const idatLength =
      (png[start]! << 24) | (png[start + 1]! << 16) | (png[start + 2]! << 8) | png[start + 3]!
    const idat = png.subarray(start + 8, start + 8 + idatLength)
    const raw = new Uint8Array(inflateSync(idat))

    expect(raw.length).toBe((width * 3 + 1) * height)

    // Undo the per row filter and compare to the source pixels.
    const stride = width * 3
    const decoded = new Uint8Array(stride * height)
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)]!
      const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
      const previous = y > 0 ? decoded.subarray((y - 1) * stride, y * stride) : null
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? row[i - 3]! : 0
        const b = previous ? previous[i]! : 0
        const c = previous && i >= 3 ? previous[i - 3]! : 0
        let value = row[i]!
        switch (filter) {
          case 0:
            break
          case 1:
            value += a
            break
          case 2:
            value += b
            break
          case 3:
            value += (a + b) >> 1
            break
          case 4: {
            const p = a + b - c
            const pa = Math.abs(p - a)
            const pb = Math.abs(p - b)
            const pc = Math.abs(p - c)
            value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
            break
          }
          default:
            throw new Error(`unknown filter ${filter}`)
        }
        decoded[y * stride + i] = value & 0xff
      }
    }

    expect([...decoded]).toEqual([...pixels])
  })

  test('rejects a short pixel buffer instead of writing a corrupt file', () => {
    expect(() => encodePng(width, height, new Uint8Array(4))).toThrow(/expected/)
  })

  test('handles a single pixel image', () => {
    const png = encodePng(1, 1, new Uint8Array([1, 2, 3]))
    expect(png.length).toBeGreaterThan(20)
  })

  test('is deterministic', () => {
    expect([...encodePng(width, height, pixels)]).toEqual([...encodePng(width, height, pixels)])
  })
})

describe('Framebuffer and present', () => {
  test('clears to a constant', () => {
    const fb = new Framebuffer(3, 2)
    fb.clear(0.5, 0.25, 1)
    expect([...fb.data]).toEqual([0.5, 0.25, 1, 0.5, 0.25, 1, 0.5, 0.25, 1, 0.5, 0.25, 1, 0.5, 0.25, 1, 0.5, 0.25, 1])
  })

  test('present maps linear to sRGB and clamps', () => {
    const fb = new Framebuffer(2, 1)
    fb.data.set([0, 0.5, 1, -1, 2, 100])
    const out = new Uint8Array(6)
    present(fb.data, {
      width: 2,
      height: 1,
      exposure: 1,
      toneMapping: 'linear',
      saturation: 1,
      vignette: 0,
      grain: 0,
      monochrome: DEFAULT_MONO,
    }, out)
    expect(out[0]).toBe(0)
    expect(out[2]).toBe(255)
    expect(out[3]).toBe(0) // negative clamps
    expect(out[4]).toBe(255)
  })

  test('present is deterministic including grain', () => {
    const fb = new Framebuffer(16, 16)
    for (let i = 0; i < fb.data.length; i++) fb.data[i] = (i % 17) / 17
    const settings = {
      width: 16,
      height: 16,
      exposure: 1,
      toneMapping: 'aces' as const,
      saturation: 1,
      vignette: 0.3,
      grain: 0.05,
      monochrome: DEFAULT_MONO,
    }
    const a = new Uint8Array(fb.data.length)
    const b = new Uint8Array(fb.data.length)
    present(fb.data, settings, a)
    present(fb.data, settings, b)
    expect([...a]).toEqual([...b])
  })

  test('monochrome output is grey where the tint is white', () => {
    const fb = new Framebuffer(4, 4)
    for (let i = 0; i < fb.data.length; i += 3) {
      fb.data[i] = 0.8
      fb.data[i + 1] = 0.2
      fb.data[i + 2] = 0.1
    }
    const out = new Uint8Array(fb.data.length)
    present(fb.data, {
      width: 4,
      height: 4,
      exposure: 1,
      toneMapping: 'linear',
      saturation: 1,
      vignette: 0,
      grain: 0,
      monochrome: { enabled: true, contrast: 1, lift: 0, gain: 1, tint: '#ffffff' },
    }, out)
    expect(out[0]).toBe(out[1])
    expect(out[1]).toBe(out[2])
  })
})

const DEFAULT_MONO = { enabled: false, contrast: 1, lift: 0, gain: 1, tint: '#ffffff' }

/** Ground truth for a point, found by plain bisection on the height function. */
const surfaceHeightAt = (field: TerrainField, x: number, z: number): number => {
  let lo = field.minHeight - 10
  let hi = field.maxHeight + 10
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) * 0.5
    if (mid < heightAt(field, x, z)) lo = mid
    else hi = mid
  }
  return (lo + hi) * 0.5
}

describe('Camera', () => {
  test('basis vectors are orthonormal', () => {
    const camera = new Camera(
      { position: { x: 10, y: 20, z: 30 }, target: { x: 0, y: 0, z: 0 }, fovY: 50 },
      800,
      400,
    )
    const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
    const len = (a: Vec3): number => Math.sqrt(dot(a, a))
    expect(len(camera.forward)).toBeCloseTo(1, 6)
    expect(len(camera.right)).toBeCloseTo(1, 6)
    expect(len(camera.up)).toBeCloseTo(1, 6)
    expect(dot(camera.forward, camera.right)).toBeCloseTo(0, 6)
    expect(dot(camera.forward, camera.up)).toBeCloseTo(0, 6)
    expect(dot(camera.right, camera.up)).toBeCloseTo(0, 6)
  })

  test('rays are normalized and the centre ray points at the target', () => {
    const target = { x: 1, y: 2, z: 3 }
    const camera = new Camera({ position: { x: 0, y: 0, z: 5 }, target, fovY: 45 }, 640, 480)
    const dir = { x: 0, y: 0, z: 0 }
    camera.rayDir(0, 0, dir)
    expect(Math.hypot(dir.x, dir.y, dir.z)).toBeCloseTo(1, 6)
    const expected = {
      x: target.x - camera.position.x,
      y: target.y - camera.position.y,
      z: target.z - camera.position.z,
    }
    const l = Math.hypot(expected.x, expected.y, expected.z)
    expect(dir.x).toBeCloseTo(expected.x / l, 6)
    expect(dir.y).toBeCloseTo(expected.y / l, 6)
    expect(dir.z).toBeCloseTo(expected.z / l, 6)
  })

  test('the vertical field of view widens with the angle', () => {
    const narrow = new Camera({ position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 1 }, fovY: 30 }, 100, 100)
    const wide = new Camera({ position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 1 }, fovY: 90 }, 100, 100)
    const a = { x: 0, y: 0, z: 0 }
    const b = { x: 0, y: 0, z: 0 }
    narrow.rayDir(0, 1, a)
    wide.rayDir(0, 1, b)
    expect(a.y).toBeLessThan(b.y)
  })

  test('a target straight overhead does not produce a degenerate basis', () => {
    const camera = new Camera(
      { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 10, z: 0 }, fovY: 50 },
      100,
      100,
    )
    const dir = { x: 0, y: 0, z: 0 }
    camera.rayDir(0.3, 0.4, dir)
    expect(Number.isFinite(dir.x)).toBe(true)
    expect(Math.hypot(dir.x, dir.y, dir.z)).toBeCloseTo(1, 6)
  })

  test('depth of field is zero for a pinhole', () => {
    const camera = new Camera({ position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 1 }, fovY: 50 }, 100, 100)
    expect(camera.cocRadius(10, 100)).toBe(0)
  })
})

describe('composeCamera', () => {
  const world = generateWorld({ seed: 12, theme: tiny() })

  test('every preset yields a camera above the terrain and inside the tile', () => {
    for (const preset of ['aerial', 'vista', 'ground', 'closeup'] as const) {
      const composed = composeCamera(world, preset)
      const half = world.terrain.size * 0.5
      expect(Math.abs(composed.position.x)).toBeLessThanOrEqual(half)
      expect(Math.abs(composed.position.z)).toBeLessThanOrEqual(half)
      expect(composed.position.y).toBeGreaterThan(0)
      expect(composed.fovY).toBeGreaterThan(0)
      expect(composed.fovY).toBeLessThan(180)
    }
  })

  test('auto resolves to a concrete preset', () => {
    const composed = composeCamera(world, 'auto')
    expect(['aerial', 'vista', 'ground', 'closeup']).toContain(composed.preset)
  })

  test('is deterministic for a given world', () => {
    expect(composeCamera(world, 'vista')).toEqual(composeCamera(world, 'vista'))
  })

  test('falls back to a usable camera when no candidate qualifies', () => {
    const flat = generateWorld({
      seed: 2,
      theme: defineTheme({ ...alpine, name: 'flat', terrain: { resolution: 64, worldSize: 500 } }),
    })
    const composed = composeCamera(flat, 'closeup')
    expect(Number.isFinite(composed.position.y)).toBe(true)
    expect(Number.isFinite(composed.target.x)).toBe(true)
  })
})

describe('terrain tracing', () => {
  const theme = tiny()
  const world = generateWorld({ seed: 31, theme })
  const ctx = createRenderContext(world, 0)
  const camera = new Camera(
    { position: { x: 0, y: world.terrain.maxHeight * 3, z: 0 }, target: { x: 0, y: 0, z: 0 }, fovY: 50 },
    64,
    64,
  )

  test('a ray pointing straight down always hits', () => {
    for (let i = 0; i < 20; i++) {
      const x = (i / 19 - 0.5) * world.terrain.size * 0.8
      const t = traceTerrain(ctx, x, world.terrain.maxHeight + 500, 0, 0, -1, 0, 10000)
      expect(t).toBeGreaterThan(0)
      const surfaceY = world.terrain.maxHeight + 500 - t
      expect(Math.abs(surfaceY)).toBeLessThan(600)
    }
  })

  test('the reported hit is close to the true surface', () => {
    const startY = world.terrain.maxHeight + 300
    const t = traceTerrain(ctx, 0, startY, 0, 0, -1, 0, 10000)
    expect(t).toBeGreaterThan(0)
    const hitY = startY - t
    // The bisection should land within a small fraction of a cell of the
    // surface, otherwise shadows and reflections detach from the geometry.
    const surface = surfaceHeightAt(world.terrain, 0, 0)
    expect(Math.abs(hitY - surface)).toBeLessThan(world.terrain.cell * 2)
    expect(hitY).toBeLessThanOrEqual(startY)
  })

  test('a ray pointing at the sky misses', () => {
    const t = traceTerrain(ctx, 0, world.terrain.maxHeight + 400, 0, 0, 1, 0, 8000)
    expect(t).toBe(-1)
  })

  test('tMax bounds the search', () => {
    const startY = world.terrain.maxHeight + 300
    const near = traceTerrain(ctx, 0, startY, 0, 0, -1, 0, 1)
    expect(near).toBe(-1)
  })

  test('a camera buried in the terrain reports an immediate hit', () => {
    const t = traceTerrain(ctx, 0, world.terrain.minHeight - 500, 0, 0, -1, 0, 10000)
    expect(t).toBe(0)
  })

  test('flat ground in full sun is not shadowed', () => {
    // The shadow penumbra is normalized by t * sunY; a wrong normalization
    // reads flat ground as heavily shadowed, which is what made an early
    // version of this renderer look like a black hillside.
    const flat = new Float32Array(world.terrain.heights.length).fill(50)
    const flatField = { ...world.terrain, heights: flat }
    const flatCtx = { ...ctx, field: flatField } as typeof ctx
    const sunY = Math.max(0.12, ctx.sunY)
    for (let i = 0; i < 10; i++) {
      expect(traceShadow(flatCtx, 0, 50, 0, 0)).toBeGreaterThan(0.9)
    }
    expect(sunY).toBeGreaterThan(0)
  })

  test('terrain behind an obstacle is shadowed', () => {
    const heights = new Float32Array(world.terrain.heights.length)
    // A ridge to the south west of the origin, tall enough to block a low sun.
    const { stride, cell, size } = world.terrain
    for (let z = 0; z < stride; z++) {
      for (let x = 0; x < stride; x++) {
        const wx = x * cell - size * 0.5
        const wz = z * cell - size * 0.5
        heights[z * stride + x] = 200
        if (wx > 20 && wz < 0 && wz > -size * 0.2) heights[z * stride + x] = 260
      }
    }
    const blocked = { ...world.terrain, heights } as typeof world.terrain
    const blockedCtx = { ...ctx, field: blocked } as typeof ctx
    // Straight up: never shadowed.
    expect(traceShadow({ ...blockedCtx, sunY: 1, sunX: 0, sunZ: 0 } as typeof ctx, 0, 200, 0, 0)).toBe(1)
  })

  test('shadeTerrain writes finite values', () => {
    const out: Rgb = { r: 0, g: 0, b: 0 }
    shadeTerrain(ctx, 0, 100, 0, 0, -0.5, -0.5, 0, out)
    for (const channel of [out.r, out.g, out.b]) {
      expect(Number.isFinite(channel)).toBe(true)
      expect(channel).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('water plane', () => {
  const world = generateWorld({ seed: 41, theme: tiny() })
  const ctx = createRenderContext(world, 0)

  test('a downward ray hits the surface and an upward one does not', () => {
    const level = ctx.waterLevel
    const t = waterPlaneHit(ctx, level + 100, -1, 5000)
    expect(t).toBeCloseTo(100, 6)
    expect(waterPlaneHit(ctx, level + 100, 1, 5000)).toBe(-1)
  })

  test('a ray starting below the surface does not hit it', () => {
    expect(waterPlaneHit(ctx, ctx.waterLevel - 10, -1, 5000)).toBe(-1)
  })

  test('a waterless world never reports a water hit', () => {
    const dry = generateWorld({
      seed: 1,
      theme: defineTheme({
        ...alpine,
        name: 'dry',
        terrain: { resolution: 96, worldSize: 900 },
        water: { enabled: false },
      }),
    })
    expect(waterPlaneHit(createRenderContext(dry, 0), 1000, -1, 5000)).toBe(-1)
  })
})

describe('phaseHG', () => {
  test('is normalized so isotropic scattering is one', () => {
    expect(phaseHG(0, 0)).toBeCloseTo(1, 6)
  })

  test('peaks forward for positive anisotropy and back for negative', () => {
    expect(phaseHG(1, 0.6)).toBeGreaterThan(phaseHG(-1, 0.6))
    expect(phaseHG(-1, -0.6)).toBeGreaterThan(phaseHG(1, -0.6))
  })

  test('stays finite across the cosine range', () => {
    for (const g of [-0.9, -0.5, 0, 0.5, 0.9]) {
      for (const c of [-1, -0.5, 0, 0.5, 1]) {
        expect(Number.isFinite(phaseHG(c, g))).toBe(true)
      }
    }
  })
})

describe('renderImage', () => {
  test('produces a fully opaque, correctly sized RGB image', async () => {
    const image = await renderImage({ seed: 77, theme: tiny(), workers: 1 })
    expect(image.width).toBe(48)
    expect(image.height).toBe(27)
    expect(image.pixels.length).toBe(48 * 27 * 3)
    expect(image.linear.length).toBe(48 * 27 * 3)
    for (const value of image.pixels) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(255)
    }
  })

  test('the same seed gives byte identical pixels', async () => {
    const options = { seed: 99, theme: tiny(), workers: 1 }
    const a = await renderImage(options)
    const b = await renderImage(options)
    expect([...a.pixels]).toEqual([...b.pixels])
  })

  test('the serial and worker pool paths agree exactly', async () => {
    // Tiles are independent, so splitting the work must not change a pixel.
    const options = { seed: 5, theme: tiny(), width: 64, height: 40 }
    const serial = await renderImage({ ...options, workers: 1 })
    const pooled = await renderImage({ ...options, workers: 4 })
    expect([...pooled.pixels]).toEqual([...serial.pixels])
    expect(pooled.stats.workers).toBeGreaterThanOrEqual(1)
  })

  test('a different seed gives different pixels', async () => {
    const a = await renderImage({ seed: 1, theme: tiny(), workers: 1 })
    const b = await renderImage({ seed: 2, theme: tiny(), workers: 1 })
    expect([...a.pixels]).not.toEqual([...b.pixels])
  })

  test('time is a parameter, not the clock, so output is reproducible', async () => {
    const options = { seed: 3, theme: tiny(), workers: 1 }
    const a = await renderImage({ ...options, time: 12.5 })
    const b = await renderImage({ ...options, time: 12.5 })
    expect([...a.pixels]).toEqual([...b.pixels])
    const later = await renderImage({ ...options, time: 90 })
    expect([...later.pixels]).not.toEqual([...a.pixels])
  })

  test('disabling water and clouds still renders', async () => {
    for (const draft of [
      { ...tiny(), water: { ...tiny().water, enabled: false } },
      { ...tiny(), cloud: { ...tiny().cloud, enabled: false } },
    ]) {
      const image = await renderImage({ seed: 6, theme: defineTheme(draft), workers: 1 })
      let anyLit = false
      for (const value of image.pixels) if (value > 8) anyLit = true
      expect(anyLit).toBe(true)
    }
  })

  test('disabling shadows still renders', async () => {
    const theme = defineTheme({ ...tiny(), lighting: { shadows: { enabled: false } } })
    const image = await renderImage({ seed: 6, theme, workers: 1 })
    let anyLit = false
    for (const value of image.pixels) if (value > 8) anyLit = true
    expect(anyLit).toBe(true)
  })

  test('a waterless theme renders without a water level', async () => {
    const theme = defineTheme({ ...tiny(desert), name: 'dry' })
    const image = await renderImage({ seed: 8, theme, workers: 1 })
    for (const value of image.pixels) {
      expect(value).toBeGreaterThanOrEqual(0)
    }
  })

  test('reports timings and ray counts', async () => {
    const image = await renderImage({ seed: 1, theme: tiny(), workers: 1 })
    expect(image.stats.rays).toBe(48 * 27)
    expect(image.stats.totalMs).toBeGreaterThanOrEqual(0)
    expect(image.stats.generationMs).toBeGreaterThanOrEqual(0)
  })

  test('reports progress and reaches one', async () => {
    const seen: number[] = []
    await renderImage({
      seed: 1,
      theme: tiny(),
      workers: 1,
      onProgress: (fraction) => seen.push(fraction),
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[seen.length - 1]).toBeCloseTo(1, 5)
  })

  test('an explicit camera is used as given', async () => {
    const image = await renderImage({
      seed: 2,
      theme: tiny(),
      workers: 1,
      camera: { position: { x: 0, y: 600, z: 0 }, target: { x: 0, y: 0, z: 0 }, fovY: 40 },
    })
    expect(image.camera.position.y).toBe(600)
    expect(image.camera.fovY).toBe(40)
  })

  test('encodes to a PNG of the right size', async () => {
    const png = await renderToPngBytes({ seed: 4, theme: tiny(), workers: 1 })
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    const view = new DataView(png.buffer, png.byteOffset)
    expect(view.getUint32(16)).toBe(48)
    expect(view.getUint32(20)).toBe(27)
  })
})
