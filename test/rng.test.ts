import { describe, expect, test } from 'bun:test'
import { Rng, hash01, hashInts, hashString, streamSeed } from '../src/core/rng/index.ts'

describe('hashing', () => {
  test('hashInts is stable and order sensitive', () => {
    expect(hashInts(1, 2, 3)).toBe(hashInts(1, 2, 3))
    expect(hashInts(1, 2, 3)).not.toBe(hashInts(3, 2, 1))
  })

  test('hashInts returns an unsigned 32 bit integer', () => {
    for (const seed of [0, 1, -1, 12345, 2 ** 31, 2 ** 32 - 1]) {
      const h = hashInts(seed, 7)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
    }
  })

  test('hashString is stable and distinguishes names', () => {
    expect(hashString('terrain')).toBe(hashString('terrain'))
    expect(hashString('terrain')).not.toBe(hashString('terrain '))
  })

  test('hash01 stays in [0,1)', () => {
    for (let i = 0; i < 500; i++) {
      const v = hash01(i, i * 7, 0x9e37)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  test('adjacent inputs do not correlate, which is what the dither relies on', () => {
    // A weak avalanche would make shadow dithering produce visible banding.
    let sameBucket = 0
    const buckets = 16
    for (let i = 0; i < 4000; i++) {
      const a = Math.floor(hash01(i, 1) * buckets)
      const b = Math.floor(hash01(i + 1, 1) * buckets)
      if (a === b) sameBucket++
    }
    // Pure chance is 1/16; allow generous slack but catch real correlation.
    expect(sameBucket / 4000).toBeLessThan(0.12)
  })
})

describe('streamSeed', () => {
  test('different names give different seeds from the same parent', () => {
    const a = streamSeed(42, 'terrain')
    const b = streamSeed(42, 'moisture')
    expect(a).not.toBe(b)
  })

  test('is a pure function of (seed, name)', () => {
    expect(streamSeed(42, 'terrain')).toBe(streamSeed(42, 'terrain'))
    expect(streamSeed(43, 'terrain')).not.toBe(streamSeed(42, 'terrain'))
  })
})

describe('Rng', () => {
  test('replays identically from the same seed', () => {
    const a = new Rng(1234)
    const b = new Rng(1234)
    const left = Array.from({ length: 200 }, () => a.next())
    const right = Array.from({ length: 200 }, () => b.next())
    expect(left).toEqual(right)
  })

  test('produces different streams for different seeds', () => {
    const a = Array.from({ length: 50 }, (_, i) => new Rng(i).next())
    expect(new Set(a).size).toBe(50)
  })

  test('next stays in [0,1)', () => {
    const rng = new Rng(7)
    for (let i = 0; i < 2000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  test('is approximately uniform', () => {
    const rng = new Rng(99)
    const buckets = new Array(10).fill(0)
    const n = 20000
    for (let i = 0; i < n; i++) buckets[Math.floor(rng.next() * 10)]! += 1
    for (const count of buckets) {
      expect(Math.abs(count - n / 10) / (n / 10)).toBeLessThan(0.1)
    }
  })

  test('stream and fork are independent of call order', () => {
    const rng = Rng.stream(5, 'alpha')
    const first = Array.from({ length: 10 }, () => rng.next())

    const rng2 = Rng.stream(5, 'alpha')
    rng2.next()
    rng2.next()
    rng2.next()
    const second = Array.from({ length: 10 }, () => rng2.next())

    // After skipping three values the sequence continues, it does not restart.
    expect(second[0]).not.toBe(first[0])
    expect(second[9]).not.toBe(first[9])
  })

  test('fork depends only on the seed, not on the parent position', () => {
    const parent = Rng.stream(5, 'alpha')
    parent.next()
    parent.next()
    const childA = parent.fork('child')
    const childB = Rng.stream(5, 'alpha').fork('child')
    expect(childA.next()).toBe(childB.next())
  })

  test('int respects its bound', () => {
    const rng = new Rng(3)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(6)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(6)
      seen.add(v)
    }
    expect(seen.size).toBe(6)
  })

  test('range respects its bounds', () => {
    const rng = new Rng(4)
    for (let i = 0; i < 1000; i++) {
      const v = rng.range(-5, 5)
      expect(v).toBeGreaterThanOrEqual(-5)
      expect(v).toBeLessThan(5)
    }
  })

  test('weighted only returns items with positive weight', () => {
    const rng = new Rng(11)
    for (let i = 0; i < 500; i++) {
      const v = rng.weighted(['a', 'b', 'c'], [0, 1, 0])
      expect(v).toBe('b')
    }
  })

  test('gaussian has roughly zero mean', () => {
    const rng = new Rng(2024)
    let sum = 0
    const n = 20000
    for (let i = 0; i < n; i++) sum += rng.gaussian()
    expect(Math.abs(sum / n)).toBeLessThan(0.05)
  })

  test('unitVector lies on the unit sphere', () => {
    const rng = new Rng(8)
    for (let i = 0; i < 200; i++) {
      const v = rng.unitVector()
      expect(Math.abs(Math.hypot(v.x, v.y, v.z) - 1)).toBeLessThan(1e-9)
    }
  })

  test('a zero seed still produces a usable stream', () => {
    const rng = new Rng(0)
    const values = new Set(Array.from({ length: 20 }, () => rng.next()))
    expect(values.size).toBe(20)
  })
})
