import { describe, expect, it } from 'vitest'
import { SNAP_RADIUS_DAYS, snapToNearestDay } from './YearRing'

describe('snapToNearestDay', () => {
  it('passes the day through when there are no legal days to snap to', () => {
    expect(snapToNearestDay(100, null)).toBe(100)
    expect(snapToNearestDay(100, new Set())).toBe(100)
  })

  it('keeps a day that is already legal', () => {
    expect(snapToNearestDay(272, new Set([270, 271, 272, 273]))).toBe(272)
  })

  it('pulls a near miss onto the nearest legal day', () => {
    expect(snapToNearestDay(268, new Set([272, 300]))).toBe(272)
    expect(snapToNearestDay(296, new Set([272, 300]))).toBe(300)
  })

  it('refuses to snap from out of reach, so the user gets a reason', () => {
    // Beyond the radius there is no plausible intent, and returning null
    // lets placeDecision explain why the drop failed instead of silently
    // teleporting the packet across the year.
    expect(snapToNearestDay(120, new Set([272]))).toBeNull()
  })

  it('snaps across 31 December', () => {
    // THE WRAP CASE. Cereal rye's window runs Aug-Nov and a drop just into
    // January is 6 days from DOY 360, not 354 days from it. A linear
    // distance would send it to the wrong end of the year.
    expect(snapToNearestDay(2, new Set([360, 150]))).toBe(360)
    expect(snapToNearestDay(362, new Set([4, 150]))).toBe(4)
  })

  it('measures wrap distance the short way round', () => {
    // 365 and 1 are adjacent days, not 364 apart.
    expect(snapToNearestDay(365, new Set([1]))).toBe(1)
    expect(snapToNearestDay(1, new Set([365]))).toBe(365)
  })

  it('honours an explicit radius', () => {
    expect(snapToNearestDay(100, new Set([130]), 40)).toBe(130)
    expect(snapToNearestDay(100, new Set([130]), 10)).toBeNull()
  })

  it('has a radius small enough not to cross a season by accident', () => {
    expect(SNAP_RADIUS_DAYS).toBeLessThan(45)
  })

  it('returns null for a pointer that was not over the ring', () => {
    expect(snapToNearestDay(null, new Set([272]))).toBeNull()
  })
})
