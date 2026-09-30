/**
 * Automatic camera placement.
 *
 * A procedural world has no art directed camera, so the renderer picks one.
 *
 * The key design decision is how a candidate is parameterized: as an eye
 * position plus a view *direction* (azimuth and depression), not as an eye and
 * a look-at point. Composition is mostly about where the horizon sits, and a
 * look-at point makes the depression angle an accident of where the target
 * happens to be. With an explicit direction, depression is a thing the scorer
 * can reward or penalize directly, and "stand far back and look slightly down
 * at the range" becomes expressible.
 *
 * Everything is a pure function of the world, so a seed always produces the
 * same framing.
 */

import { clamp01, degToRad, radToDeg, type Vec3 } from '../../core/math/index.ts'
import { heightAt } from '../../world/terrain/sample.ts'
import type { TerrainField, World } from '../../world/types.ts'

export type CameraPreset = 'auto' | 'aerial' | 'vista' | 'ground' | 'closeup'

export interface ComposedCamera {
  position: Vec3
  target: Vec3
  /** Degrees. */
  fovY: number
  preset: CameraPreset
  /** Depression of the view axis in degrees; positive looks down. */
  depression: number
  /** Lower is better; exposed for debugging. */
  score: number
}

interface Peak {
  x: number
  z: number
  height: number
}

const clampToTile = (field: TerrainField, x: number, z: number): [number, number] => {
  const margin = field.size * 0.5 - field.cell * 2
  return [Math.min(margin, Math.max(-margin, x)), Math.min(margin, Math.max(-margin, z))]
}

const findPeak = (field: TerrainField): Peak => {
  let best = -Infinity
  let px = 0
  let pz = 0
  const step = Math.max(1, Math.floor(field.resolution / 96))
  for (let z = 0; z < field.stride; z += step) {
    for (let x = 0; x < field.stride; x += step) {
      const h = field.heights[z * field.stride + x]!
      if (h > best) {
        best = h
        px = x * field.cell - field.size * 0.5
        pz = z * field.cell - field.size * 0.5
      }
    }
  }
  return { x: px, z: pz, height: best }
}

/** Ground centroid, weighted by how far the terrain rises above the water. */
const findCentroid = (field: TerrainField, waterLevel: number): { x: number; z: number } => {
  let sx = 0
  let sz = 0
  let sw = 0
  const step = Math.max(1, Math.floor(field.resolution / 64))
  for (let z = 0; z < field.stride; z += step) {
    for (let x = 0; x < field.stride; x += step) {
      const h = field.heights[z * field.stride + x]!
      const w = Math.max(0, h - waterLevel)
      if (w <= 0) continue
      sx += x * field.cell * w
      sz += z * field.cell * w
      sw += w
    }
  }
  if (sw <= 0) return { x: 0, z: 0 }
  return { x: sx / sw - field.size * 0.5, z: sz / sw - field.size * 0.5 }
}

interface Candidate {
  eye: Vec3
  azimuth: number
  /** Positive looks down, in degrees. */
  depression: number
  fovY: number
  preset: CameraPreset
}

const targetFrom = (candidate: Candidate, distance: number): Vec3 => {
  const d = degToRad(candidate.depression)
  const flat = Math.cos(d)
  return {
    x: candidate.eye.x + Math.cos(candidate.azimuth) * flat * distance,
    y: candidate.eye.y - Math.sin(d) * distance,
    z: candidate.eye.z + Math.sin(candidate.azimuth) * flat * distance,
  }
}

export interface ScoreBreakdown {
  total: number
  relief: number
  occlusion: number
  blocked: number
  water: number
  offTile: number
  crossLight: number
  depression: number
  distance: number
}

/**
 * Score one candidate. Every accumulated term is a mean over the sample count:
 * mixing a term that sums to fifty with terms that max out at two makes the
 * weights meaningless, which is an easy mistake to make and hard to spot.
 */
const scoreCandidate = (
  field: TerrainField,
  waterLevel: number,
  reliefScale: number,
  sun: Vec3,
  candidate: Candidate,
): ScoreBreakdown => {
  const lookDistance = field.size * 0.6
  const target = targetFrom(candidate, lookDistance)
  const eye = candidate.eye

  let dx = target.x - eye.x
  let dy = target.y - eye.y
  let dz = target.z - eye.z
  const distance = Math.hypot(dx, dy, dz) || 1
  dx /= distance
  dy /= distance
  dz /= distance

  const steps = 72
  const reach = Math.min(lookDistance, field.size * 0.9)
  const half = field.size * 0.5
  let occlusion = 0
  let relief = 0
  let water = 0
  let blocked = 0
  let offTile = 0

  for (let i = 0; i < steps; i++) {
    const f = (i + 0.5) / steps
    const t = f * reach
    const px = eye.x + dx * t
    const pz = eye.z + dz * t
    // A sample outside the tile is not scored at all. Clamping to the edge
    // would make a view aimed off the map read a constant height forever, which
    // looks like either endless water or endless flat ground and wins the water
    // or the relief term outright.
    if (px < -half || px > half || pz < -half || pz > half) {
      offTile++
      continue
    }
    const h = heightAt(field, px, pz)
    // Ground further away may be higher than the eye, but only up to a slope
    // the eye can actually see over. A shallow limit is what keeps the camera
    // out of the nearest hillside: foreground that rises faster than this is
    // a wall, not a vista.
    const allowed = eye.y + t * 0.22
    if (h > allowed) {
      occlusion += clamp01((h - allowed) / reliefScale)
      blocked++
    } else {
      relief += Math.min(2, Math.max(0, h - waterLevel) / 160) * f
    }
    if (h < waterLevel) water++
  }

  const reliefMean = relief / steps
  const occlusionMean = occlusion / steps
  const waterFraction = water / steps
  const blockedFraction = blocked / steps
  const offTileFraction = offTile / steps

  // Cross lighting: the sun well off the view axis gives the most modelling.
  const horizontal = Math.hypot(dx, dz) || 1e-6
  const sunHorizontal = Math.hypot(sun.x, sun.z) || 1e-6
  const alignment = Math.abs(
    (dx / horizontal) * (sun.x / sunHorizontal) + (dz / horizontal) * (sun.z / sunHorizontal),
  )
  const crossLight = (1 - alignment) * 2

  // Composition lives here. A landscape wants the horizon high in the frame
  // and some sky above it: a steep depression buries the subject in near
  // ground, and a negative one has no foreground at all.
  const depressionPenalty = -Math.max(0, candidate.depression - 9) * 0.16

  const standoff = Math.min(1.3, distance / (field.size * 0.5))

  const total =
    reliefMean * 0.8 -
    occlusionMean * 4.5 -
    blockedFraction * blockedFraction * 14 -
    waterFraction * 3.0 -
    // Aiming off the edge of the world is a view of nothing.
    offTileFraction * 12 +
    crossLight +
    depressionPenalty +
    standoff

  return {
    total,
    relief: reliefMean,
    occlusion: occlusionMean,
    blocked: blockedFraction,
    water: waterFraction,
    offTile: offTileFraction,
    crossLight,
    depression: depressionPenalty,
    distance: standoff,
  }
}

interface WorldContext {
  field: TerrainField
  waterLevel: number
  reliefScale: number
  peak: Peak
  centroid: { x: number; z: number }
  sun: Vec3
}

const buildCandidates = (ctx: WorldContext, preset: CameraPreset): Candidate[] => {
  const { field, waterLevel, reliefScale, peak } = ctx
  const out: Candidate[] = []

  const makeEye = (x: number, z: number, heightFactor: number, clearFactor: number): Vec3 => {
    const [cx, cz] = clampToTile(field, x, z)
    const ground = heightAt(field, cx, cz)
    const wanted = waterLevel + reliefScale * heightFactor
    // Never inside a hill: a candidate that starts underground cannot be
    // rescued by any score.
    const y = Math.max(wanted, ground + reliefScale * clearFactor + 4)
    return { x: cx, y, z: cz }
  }

  /** Ring of viewpoints around the tallest peak, looking back towards it. */
  const ring = (
    radii: number[],
    count: number,
    heightFactors: number[],
    depressions: number[],
    /** Radians to swing the view off the peak, for cross lighting. */
    swings: number[],
    fovY: number,
    clearFactor: number,
  ): void => {
    for (const radius of radii) {
      for (let i = 0; i < count; i++) {
        const ringAngle = (i / count) * Math.PI * 2
        const eye = makeEye(
          peak.x + Math.cos(ringAngle) * field.size * radius,
          peak.z + Math.sin(ringAngle) * field.size * radius,
          heightFactors[Math.floor(i / count) % heightFactors.length]!,
          clearFactor,
        )
        const towardsPeak = Math.atan2(peak.z - eye.z, peak.x - eye.x)
        for (const swing of swings) {
          for (const depression of depressions) {
            for (const heightFactor of heightFactors) {
              const positioned = makeEye(
                peak.x + Math.cos(ringAngle) * field.size * radius,
                peak.z + Math.sin(ringAngle) * field.size * radius,
                heightFactor,
                clearFactor,
              )
              out.push({
                eye: positioned,
                azimuth: towardsPeak + swing,
                depression,
                fovY,
                preset,
              })
            }
          }
        }
      }
    }
  }

  switch (preset) {
    case 'aerial':
      ring([0.18, 0.3, 0.42], 8, [0.5, 0.8, 1.2], [8, 16, 26], [-0.4, 0, 0.4], 52, 0.2)
      break
    case 'vista':
      // The swings matter more than they look: a view aimed only at the tallest
      // peak always looks inland, which is the wrong shot for a coastal world.
      // Swinging round to face away from the peak is what puts the shoreline,
      // and the sea beyond it, into the frame.
      ring(
        [0.3, 0.42, 0.55, 0.68],
        10,
        [0.45, 0.65, 0.9],
        [1, 4, 8],
        [-2.4, -1.4, -0.45, -0.2, 0, 0.2, 0.45, 1.4, 2.4],
        46,
        0.14,
      )
      break
    case 'ground': {
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2
        for (const radius of [0.16, 0.28, 0.4]) {
          const [cx, cz] = clampToTile(
            field,
            peak.x + Math.cos(a) * field.size * radius,
            peak.z + Math.sin(a) * field.size * radius,
          )
          const h = heightAt(field, cx, cz)
          if (h < waterLevel + 3) continue
          out.push({
            eye: { x: cx, y: h + 2.2, z: cz },
            azimuth: Math.atan2(peak.z - cz, peak.x - cx),
            depression: 1,
            fovY: 58,
            preset,
          })
        }
      }
      break
    }
    case 'closeup': {
      if (!field.hasWater) break
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2
        for (const radius of [0.1, 0.2, 0.32]) {
          const [cx, cz] = clampToTile(
            field,
            peak.x + Math.cos(a) * field.size * radius,
            peak.z + Math.sin(a) * field.size * radius,
          )
          const h = heightAt(field, cx, cz)
          if (h < waterLevel + 2 || h > waterLevel + reliefScale * 0.35) continue
          out.push({
            eye: { x: cx, y: h + 14, z: cz },
            azimuth: Math.atan2(peak.z - cz, peak.x - cx),
            depression: 4,
            fovY: 50,
            preset,
          })
        }
      }
      break
    }
    default:
      break
  }

  return out
}

const choosePreset = (world: World, waterLevel: number): CameraPreset => {
  const water = world.water.coverage
  const relief = world.terrain.maxHeight - waterLevel
  // Very watery worlds get a human height view on the shore; everything else
  // gets a standing-back vista, which is the only framing that reliably reads
  // as a landscape. Low relief plus a lot of water is a coastline, and an
  // aerial view of a coastline is a map.
  if (water > 0.55) return 'ground'
  if (relief < 130) return 'ground'
  return 'vista'
}

const fallback = (ctx: WorldContext): Candidate => {
  const { field, waterLevel, reliefScale, peak } = ctx
  const m = field.size * 0.45
  return {
    eye: {
      x: clampToTile(field, peak.x * 2 - m, peak.z * 2 - m)[0],
      y: waterLevel + reliefScale * 0.6,
      z: clampToTile(field, peak.x * 2 - m, peak.z * 2 - m)[1],
    },
    azimuth: Math.atan2(-peak.z, -peak.x),
    depression: 12,
    fovY: 50,
    preset: 'vista',
  }
}

export const composeCamera = (
  world: World,
  preset: CameraPreset = 'auto',
): ComposedCamera => {
  const field = world.terrain
  // A world with no water still needs a shoreline height to reason about.
  const waterLevel = field.hasWater ? field.waterLevel : field.minHeight
  // The full relief, not the relief above the waterline. For a mostly ocean
  // world the land-above-water relief is tiny, and scaling camera heights by it
  // puts an "aerial" viewpoint barely above the sea.
  const reliefScale = Math.max(1, field.maxHeight - field.minHeight)
  const resolved = preset === 'auto' ? choosePreset(world, waterLevel) : preset

  const ctx: WorldContext = {
    field,
    waterLevel,
    reliefScale,
    peak: findPeak(field),
    centroid: findCentroid(field, waterLevel),
    sun: world.light.direction,
  }

  let candidates = buildCandidates(ctx, resolved)
  if (candidates.length === 0) candidates = [fallback(ctx)]

  let best = candidates[0]!
  let bestScore = -Infinity
  for (const candidate of candidates) {
    const score = scoreCandidate(field, waterLevel, reliefScale, ctx.sun, candidate)
    if (score.total > bestScore) {
      bestScore = score.total
      best = candidate
    }
  }

  const depression = radToDeg(Math.atan2(best.eye.y - targetFrom(best, field.size * 0.6).y, field.size * 0.6))
  return {
    position: best.eye,
    target: targetFrom(best, field.size * 0.6),
    fovY: best.fovY,
    preset: resolved,
    depression,
    score: bestScore,
  }
}

/** Exposed for the camera diagnostic script. */
export const inspectCamera = (
  world: World,
  preset: CameraPreset,
): { candidate: Candidate; score: ScoreBreakdown }[] => {
  const field = world.terrain
  const waterLevel = field.hasWater ? field.waterLevel : field.minHeight
  // The full relief, not the relief above the waterline. For a mostly ocean
  // world the land-above-water relief is tiny, and scaling camera heights by it
  // puts an "aerial" viewpoint barely above the sea.
  const reliefScale = Math.max(1, field.maxHeight - field.minHeight)
  const ctx: WorldContext = {
    field,
    waterLevel,
    reliefScale,
    peak: findPeak(field),
    centroid: findCentroid(field, waterLevel),
    sun: world.light.direction,
  }
  return buildCandidates(ctx, preset).map((candidate) => ({
    candidate,
    score: scoreCandidate(field, waterLevel, reliefScale, ctx.sun, candidate),
  }))
}
