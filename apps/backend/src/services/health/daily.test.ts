import { describe, expect, test } from 'vitest'

import { groupByMetric, minBaselineDays, validateDailyOptions, withBaselines } from './daily.ts'

const base = { end: '2026-10-10', metrics: ['hrv_sleep'], start: '2026-10-01', tz: 'UTC' }

describe('withBaselines', () => {
  test('empty input gives no points', () => {
    expect(withBaselines([], '2026-01-01', 30, 7)).toEqual([])
  })

  test('only days on or after start are returned, earlier days feed the baseline', () => {
    const points = [
      { date: '2026-01-01', value: 10 },
      { date: '2026-01-02', value: 20 },
      { date: '2026-01-03', value: 30 },
    ]
    const out = withBaselines(points, '2026-01-03', 30, 2)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ baseline: { mean: 15, n: 2, sd: Math.sqrt(50) }, date: '2026-01-03', value: 30 })
  })

  test('baseline is null with fewer than minN values (sparse history)', () => {
    const points = [
      { date: '2026-01-01', value: 10 },
      { date: '2026-01-20', value: 20 },
    ]
    expect(withBaselines(points, '2026-01-01', 30, 2).map((p) => p.baseline)).toEqual([null, null])
  })

  test('window is [date − baselineDays, date − 1]: the edge day counts, one day earlier does not', () => {
    const points = [
      { date: '2026-01-01', value: 100 },
      { date: '2026-01-02', value: 4 },
      { date: '2026-01-11', value: 6 },
      { date: '2026-01-12', value: 50 },
    ]
    const [p] = withBaselines(points, '2026-01-12', 10, 1)
    expect(p!.baseline).toEqual({ mean: 5, n: 2, sd: Math.sqrt(2) })
  })

  test('the day itself is excluded', () => {
    const points = [
      { date: '2026-01-01', value: 1 },
      { date: '2026-01-02', value: 1000 },
    ]
    expect(withBaselines(points, '2026-01-02', 30, 1)[0]!.baseline).toEqual({ mean: 1, n: 1, sd: 0 })
  })

  test('SD of a constant is 0', () => {
    const points = Array.from({ length: 8 }, (_, i) => ({ date: `2026-01-0${i + 1}`, value: 42 }))
    expect(withBaselines(points, '2026-01-08', 30, 7)[0]!.baseline).toEqual({ mean: 42, n: 7, sd: 0 })
  })
})

describe('groupByMetric', () => {
  test('groups rows per metric, ascending by date', () => {
    const grouped = groupByMetric([
      { date: '2026-01-02', metric: 'a', value: 2 },
      { date: '2026-01-01', metric: 'a', value: 1 },
      { date: '2026-01-01', metric: 'b', value: 3 },
    ])
    expect(grouped.get('a')).toEqual([
      { date: '2026-01-01', value: 1 },
      { date: '2026-01-02', value: 2 },
    ])
    expect(grouped.get('b')).toEqual([{ date: '2026-01-01', value: 3 }])
  })
})

describe('validateDailyOptions', () => {
  test('min_baseline_days is max(7, round(baselineDays / 2))', () => {
    expect(minBaselineDays(7)).toBe(7)
    expect(minBaselineDays(30)).toBe(15)
    expect(minBaselineDays(181)).toBe(91)
  })

  test('accepts a valid request', () => {
    expect(() => validateDailyOptions(base)).not.toThrow()
  })

  test('lists every unknown metric', () => {
    expect(() => validateDailyOptions({ ...base, metrics: ['hrv_sleep', 'bogus', 'nope'] })).toThrow(
      'Unknown health metrics: bogus, nope',
    )
  })

  test.each([
    [{ end: '2026-01-01', start: '2026-01-02' }, 'start must be on or before end'],
    [{ end: '2036-01-12', start: '2026-01-01' }, 'Range is limited to 3660 days'],
    [{ baselineDays: 6 }, 'baseline_days must be between 7 and 180'],
    [{ baselineDays: 181 }, 'baseline_days must be between 7 and 180'],
  ])('rejects %j', (override, message) => {
    expect(() => validateDailyOptions({ ...base, ...override })).toThrow(message)
  })

  test('errors carry status 400', () => {
    try {
      validateDailyOptions({ ...base, metrics: ['bogus'] })
    } catch (error) {
      expect((error as { status: number }).status).toBe(400)
    }
  })
})
