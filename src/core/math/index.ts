/**
 * Small math primitives shared by the generators and the renderers.
 *
 * These are intentionally plain-object based (no classes, no allocation
 * strategies) so the hot loops in the CPU renderer stay monomorphic.
 */

export interface Vec2 {
  x: number
  y: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** An RGB triple. All color math in this project happens in linear space
 *  unless a function name says otherwise. Values are nominally 0..1 but may
 *  exceed 1 for high dynamic range lighting. */
export interface Rgb {
  r: number
  g: number
  b: number
}

export const v2 = (x = 0, y = 0): Vec2 => ({ x, y })
export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const rgb = (r = 0, g = 0, b = 0): Rgb => ({ r, g, b })

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

export const invLerp = (a: number, b: number, x: number): number =>
  a === b ? 0 : (x - a) / (b - a)

/** Remap x from range [a,b] into range [c,d], clamped to the output range. */
export const remap = (x: number, a: number, b: number, c: number, d: number): number =>
  lerp(c, d, clamp01(invLerp(a, b, x)))

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01(invLerp(a, b, x))
  return t * t * (3 - 2 * t)
}

export const smootherstep = (a: number, b: number, x: number): number => {
  const t = clamp01(invLerp(a, b, x))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export const saturate = clamp01

export const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0)

export const fract = (x: number): number => x - Math.floor(x)

/** Exponential decay between 1 at `x = a` and 0 as x -> infinity.
 *  Used for fog and for a cheap "distance falloff". */
export const falloff = (x: number, a: number, k: number): number =>
  x <= a ? 1 : Math.exp(-(x - a) * k)

export const degToRad = (deg: number): number => (deg * Math.PI) / 180
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI

// ---------------------------------------------------------------------------
// Vec3
// ---------------------------------------------------------------------------

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

export const lengthSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z

export const length = (a: Vec3): number => Math.sqrt(lengthSq(a))

export const normalize = (a: Vec3): Vec3 => {
  const l = length(a)
  return l > 0 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 }
}

export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })

export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })

export const scale3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })

export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
})

/** Any unit vector perpendicular to n. Branch on the dominant axis so the
 *  cross product never degenerates. */
export const perpendicular = (n: Vec3): Vec3 => {
  const ax = Math.abs(n.x)
  const ay = Math.abs(n.y)
  const az = Math.abs(n.z)
  const helper: Vec3 =
    ax < ay && ax < az ? { x: 1, y: 0, z: 0 } : ay < az ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 }
  return normalize(cross(n, helper))
}

/** Rotate v around the unit axis n by angle radians (Rodrigues). */
export const rotateAround = (v: Vec3, n: Vec3, angle: number): Vec3 => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const d = dot(n, v)
  const cx = cross(n, v)
  return {
    x: v.x * c + cx.x * s + n.x * d * (1 - c),
    y: v.y * c + cx.y * s + n.y * d * (1 - c),
    z: v.z * c + cx.z * s + n.z * d * (1 - c),
  }
}
