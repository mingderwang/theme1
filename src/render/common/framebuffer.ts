/**
 * A linear-light RGB framebuffer.
 *
 * Renders accumulate in linear space; `present` in colorPipeline.ts is the
 * only place that tone maps and encodes.
 */

export class Framebuffer {
  readonly width: number
  readonly height: number
  readonly data: Float32Array

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.data = new Float32Array(width * height * 3)
  }

  clear(r = 0, g = 0, b = 0): void {
    const d = this.data
    for (let i = 0; i < d.length; i += 3) {
      d[i] = r
      d[i + 1] = g
      d[i + 2] = b
    }
  }
}
