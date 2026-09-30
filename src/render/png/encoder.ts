/**
 * A minimal PNG encoder.
 *
 * PNG is a container of zlib streams, and `node:zlib` is already in the
 * runtime, so writing an encoder is cheaper than taking a dependency. Scanline
 * filters are chosen per row with the usual minimum-sum-of-absolute-differences
 * heuristic, which roughly halves the output size on noisy terrain images.
 */

import { deflateSync } from 'node:zlib'

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = (buf: Uint8Array): number => {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  const crcInput = out.subarray(4, 8 + data.length)
  view.setUint32(8 + data.length, crc32(crcInput))
  return out
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

const filterRow = (
  row: Uint8Array,
  prev: Uint8Array | null,
  bpp: number,
  out: Uint8Array,
): number => {
  const n = row.length
  // Sum of absolute signed values is the standard filter heuristic.
  let bestType = 0
  let bestScore = Infinity
  const candidates = [0, 1, 2, 3, 4]
  const scores = [0, 0, 0, 0, 0]

  for (let type of candidates) {
    let score = 0
    for (let i = 0; i < n; i++) {
      const a = i >= bpp ? row[i - bpp]! : 0
      const b = prev ? prev[i]! : 0
      const c = prev && i >= bpp ? prev[i - bpp]! : 0
      let v: number
      switch (type) {
        case 1:
          v = row[i]! - a
          break
        case 2:
          v = row[i]! - b
          break
        case 3:
          v = row[i]! - ((a + b) >> 1)
          break
        case 4:
          v = row[i]! - paeth(a, b, c)
          break
        default:
          v = row[i]!
      }
      v &= 0xff
      scores[type] = v < 128 ? v : 256 - v
      score += scores[type]!
    }
    if (score < bestScore) {
      bestScore = score
      bestType = type
    }
  }

  for (let i = 0; i < n; i++) {
    const a = i >= bpp ? row[i - bpp]! : 0
    const b = prev ? prev[i]! : 0
    const c = prev && i >= bpp ? prev[i - bpp]! : 0
    let v: number
    switch (bestType) {
      case 1:
        v = row[i]! - a
        break
      case 2:
        v = row[i]! - b
        break
      case 3:
        v = row[i]! - ((a + b) >> 1)
        break
      case 4:
        v = row[i]! - paeth(a, b, c)
        break
      default:
        v = row[i]!
    }
    out[i] = v & 0xff
  }
  return bestType
}

export interface PngOptions {
  /** Byte per pixel: 3 for RGB, 4 for RGBA, 1 for grayscale. */
  channels?: 1 | 3 | 4
  /** 0 (none) to 9 (maximum). */
  level?: number
}

/** Encode interleaved 8 bit pixel data as a PNG. */
export const encodePng = (
  width: number,
  height: number,
  pixels: Uint8Array,
  options: PngOptions = {},
): Uint8Array => {
  const channels = options.channels ?? 3
  const bpp = channels
  const stride = width * channels
  if (pixels.length < stride * height) {
    throw new Error(`encodePng: expected ${stride * height} bytes, received ${pixels.length}`)
  }

  // Filtered scanlines, each prefixed with its filter type byte.
  const raw = new Uint8Array((stride + 1) * height)
  let previous: Uint8Array | null = null
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride)
    const target = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const type = filterRow(row, previous, bpp, target)
    raw[y * (stride + 1)] = type
    previous = row
  }

  const compressed = new Uint8Array(deflateSync(raw, { level: options.level ?? 6 }))

  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width)
  ihdrView.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = channels === 1 ? 0 : channels === 4 ? 6 : 2 // colour type
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ]

  let total = 0
  for (const part of parts) total += part.length
  const png = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.length
  }
  return png
}
