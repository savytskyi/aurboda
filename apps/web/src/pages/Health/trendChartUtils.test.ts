import type { HealthDailyPoint } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  bandSegments,
  daysBetween,
  nearestIndex,
  paddedDomain,
  rollingMean,
  stepIndex,
} from './trendChartUtils'

const point = (
  date: string,
  value: number,
  baseline: { mean: number; sd: number } | null,
): HealthDailyPoint => ({
  baseline: baseline ? { ...baseline, n: 30 } : null,
  date,
  value,
})

describe('bandSegments', () => {
  it('returns one run for consecutive days with baselines', () => {
    const segments = bandSegments([
      point('2026-10-01', 30, { mean: 30, sd: 3 }),
      point('2026-10-02', 31, { mean: 31, sd: 2 }),
    ])
    expect(segments).toEqual([
      [
        { date: '2026-10-01', hi: 33, lo: 27, mean: 30 },
        { date: '2026-10-02', hi: 33, lo: 29, mean: 31 },
      ],
    ])
  })

  it('breaks where a baseline is missing', () => {
    const segments = bandSegments([
      point('2026-10-01', 30, { mean: 30, sd: 3 }),
      point('2026-10-02', 31, null),
      point('2026-10-03', 32, { mean: 31, sd: 3 }),
    ])
    expect(segments.map((s) => s.map((p) => p.date))).toEqual([['2026-10-01'], ['2026-10-03']])
  })

  it('breaks across missing days', () => {
    const segments = bandSegments([
      point('2026-10-01', 30, { mean: 30, sd: 3 }),
      point('2026-10-02', 30, { mean: 30, sd: 3 }),
      point('2026-10-05', 30, { mean: 30, sd: 3 }),
    ])
    expect(segments.map((s) => s.length)).toEqual([2, 1])
  })

  it('returns nothing when no point has a baseline', () => {
    expect(bandSegments([point('2026-10-01', 30, null)])).toEqual([])
    expect(bandSegments([])).toEqual([])
  })
})

describe('daysBetween', () => {
  it('lists every day inclusive, across month ends', () => {
    expect(daysBetween('2026-09-29', '2026-10-02')).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ])
    expect(daysBetween('2026-10-02', '2026-10-01')).toEqual([])
  })
})

describe('paddedDomain', () => {
  it('pads the extent by 10 %', () => {
    expect(paddedDomain([20, 40])).toEqual([18, 42])
  })

  it('does not go below zero for non-negative data', () => {
    expect(paddedDomain([0, 10])).toEqual([0, 11])
  })

  it('keeps negative values and pads a flat series', () => {
    expect(paddedDomain([-0.5, 0.5])).toEqual([-0.6, 0.6])
    expect(paddedDomain([50, 50])).toEqual([45, 55])
  })

  it('returns null without values', () => {
    expect(paddedDomain([])).toBeNull()
  })
})

describe('nearestIndex', () => {
  it('finds the closest position', () => {
    expect(nearestIndex([0, 10, 20], 14)).toBe(1)
    expect(nearestIndex([0, 10, 20], 16)).toBe(2)
  })
})

describe('stepIndex', () => {
  it('moves with arrows, Home and End, starting from the latest', () => {
    expect(stepIndex('ArrowLeft', null, 5)).toBe(4)
    expect(stepIndex('ArrowLeft', 0, 5)).toBe(0)
    expect(stepIndex('ArrowRight', 2, 5)).toBe(3)
    expect(stepIndex('ArrowRight', 5, 5)).toBe(5)
    expect(stepIndex('Home', 3, 5)).toBe(0)
    expect(stepIndex('End', 0, 5)).toBe(5)
  })

  it('ignores other keys and empty charts', () => {
    expect(stepIndex('a', 1, 5)).toBeNull()
    expect(stepIndex('ArrowLeft', null, -1)).toBeNull()
  })
})

describe('rollingMean', () => {
  const p = (date: string, value: number) => ({ baseline: null, date, value })

  it('averages the trailing 7 calendar days', () => {
    const points = Array.from({ length: 9 }, (_, i) => p(`2026-10-0${i + 1}`, i + 1))
    const means = rollingMean(points).map((x) => x.value)
    expect(means.slice(0, 3)).toEqual([1, 1.5, 2])
    expect(means[6]).toBe(4)
    expect(means[8]).toBe(6)
  })

  it('does not reach back across a gap longer than the window', () => {
    const means = rollingMean([p('2026-10-01', 10), p('2026-10-05', 20), p('2026-10-12', 40)])
    expect(means.map((x) => x.value)).toEqual([10, 15, 40])
  })

  it('keeps dates and baselines', () => {
    const baseline = { mean: 5, n: 10, sd: 1 }
    expect(rollingMean([{ baseline, date: '2026-10-01', value: 3 }])).toEqual([
      { baseline, date: '2026-10-01', value: 3 },
    ])
  })
})
