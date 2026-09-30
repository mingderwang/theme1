/**
 * A pinhole camera. Deliberately basis-vector based rather than a matrix: the
 * CPU renderer only ever needs a ray direction per pixel.
 */

import type { Vec3 } from '../../core/math/index.ts'
import { degToRad, normalize, sub3, cross, dot } from '../../core/math/index.ts'

export interface CameraSpec {
  position: Vec3
  target: Vec3
  up?: Vec3
  /** Vertical field of view in degrees. */
  fovY: number
  /** Defocus distance in meters. Omit or set 0 for a pinhole. */
  focusDistance?: number
  /** Lens aperture in meters; small values give a deep depth of field. */
  aperture?: number
}

export class Camera {
  readonly position: Vec3
  readonly forward: Vec3
  readonly right: Vec3
  readonly up: Vec3
  readonly tanHalfFov: number
  readonly aspect: number
  readonly focusDistance: number
  readonly aperture: number

  constructor(spec: CameraSpec, width: number, height: number) {
    this.position = spec.position
    this.aspect = width / height
    this.tanHalfFov = Math.tan(degToRad(spec.fovY) * 0.5)
    this.focusDistance = spec.focusDistance ?? 0

    const worldUp = spec.up ?? { x: 0, y: 1, z: 0 }
    const dir = normalize(sub3(spec.target, spec.position))

    // Guard against a target directly above or below the camera.
    const fallbackUp =
      Math.abs(dot(dir, worldUp)) > 0.999 ? { x: 0, y: 0, z: 1 } : worldUp

    this.right = normalize(cross(dir, fallbackUp))
    this.up = cross(this.right, dir)
    this.forward = dir

    // A physically sized aperture is huge in scene units, so scale it: the
    // blur radius in pixels for a point at distance d is
    //   aperture * |1/d - 1/focus| * (imageHeight / (2 tanHalfFov))
    this.aperture = (spec.aperture ?? 0) * 0.001
  }

  /**
   * Ray direction for a point in normalized device coordinates.
   * `sx` and `sy` run from -1 to 1 across the image.
   */
  rayDir(sx: number, sy: number, out: Vec3): Vec3 {
    const px = sx * this.tanHalfFov * this.aspect
    const py = sy * this.tanHalfFov
    out.x = this.forward.x + this.right.x * px + this.up.x * py
    out.y = this.forward.y + this.right.y * px + this.up.y * py
    out.z = this.forward.z + this.right.z * px + this.up.z * py
    const len = Math.hypot(out.x, out.y, out.z)
    out.x /= len
    out.y /= len
    out.z /= len
    return out
  }

  /** Circle of confusion radius in pixels, used for depth of field. */
  cocRadius(distance: number, imageHeight: number): number {
    if (this.aperture <= 0) return 0
    const focus = this.focusDistance > 0 ? this.focusDistance : distance
    const blur = Math.abs(1 / Math.max(distance, 0.001) - 1 / Math.max(focus, 0.001))
    return (this.aperture * blur * imageHeight) / (2 * this.tanHalfFov)
  }
}
