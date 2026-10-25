import type { HealthDailyPoint } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { latestDate, latestDelta, latestPoint, rangeAverage, splitToday, valueOn } from './series'

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

describe('splitToday', () => {
  const pts = [
    { baseline: null, date: '2026-10-24', value: 9000 },
    { baseline: null, date: '2026-10-25', value: 1668 },
  ]
  it('holds back today for accumulating totals', () => {
    const { complete, today } = splitToday(pts, '2026-10-25', true)
    expect(complete.map((point) => point.date)).toEqual(['2026-10-24'])
    expect(today?.value).toBe(1668)
  })
  it('keeps every day for level metrics', () => {
    expect(splitToday(pts, '2026-10-25', false)).toEqual({ complete: pts, today: null })
  })
})
