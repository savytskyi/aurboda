import type { HealthDailyPoint } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { latestDate, latestDelta, latestPoint, rangeAverage, valueOn } from './series'

const p = (date: string, value: number, mean?: number): HealthDailyPoint => ({
  baseline: mean === undefined ? null : { mean, n: 30, sd: 2 },
  date,
  value,
})

describe('series helpers', () => {
  const points = [p('2026-10-01', 10), p('2026-10-02', 20, 15)]

  it('reads the latest point and its delta', () => {
    expect(latestPoint(points)?.date).toBe('2026-10-02')
    expect(latestDelta(points)).toBe(5)
    expect(latestDelta([p('2026-10-01', 10)])).toBeNull()
    expect(latestPoint([])).toBeNull()
    expect(latestPoint(undefined)).toBeNull()
  })

  it('averages the range', () => {
    expect(rangeAverage(points)).toBe(15)
    expect(rangeAverage([])).toBeNull()
  })

  it('finds the value on a day', () => {
    expect(valueOn(points, '2026-10-01')).toBe(10)
    expect(valueOn(points, '2026-10-05')).toBeNull()
    expect(valueOn(points, null)).toBeNull()
  })

  it('finds the latest day across series', () => {
    expect(latestDate([points, [p('2026-10-03', 1)], undefined])).toBe('2026-10-03')
    expect(latestDate([[], undefined])).toBeNull()
  })
})
