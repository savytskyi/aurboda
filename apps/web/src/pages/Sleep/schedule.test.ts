import type { BedtimeRecommendation } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { clockDomain, clockTicks, humanise, recommendationLines, scheduleStatsText } from './schedule'

const rec = (overrides: Partial<BedtimeRecommendation>): BedtimeRecommendation => ({
  date: '2026-10-24',
  last_optimal: null,
  optimal: null,
  recommendation: null,
  status: 'optimal_found',
  ...overrides,
})

describe('clockDomain', () => {
  it('spans earliest bedtime to latest wake, on whole hours', () => {
    const nights = [
      { bedtime_clock_min: 1270, wake_clock_min: 340 },
      { bedtime_clock_min: 1350, wake_clock_min: 400 },
    ]
    expect(clockDomain(nights)).toEqual([1260, 1440 + 420])
  })

  it('places a bedtime after midnight after 23:30', () => {
    expect(clockDomain([{ bedtime_clock_min: 1470, wake_clock_min: 450 }])).toEqual([1440, 1440 + 480])
  })

  it('includes the optimal window', () => {
    expect(
      clockDomain([{ bedtime_clock_min: 1350, wake_clock_min: 360 }], {
        end_clock_min: 1245,
        start_clock_min: 1200,
      }),
    ).toEqual([1200, 1800])
  })

  it('is null without nights', () => {
    expect(clockDomain([])).toBeNull()
  })
})

describe('clockTicks', () => {
  it('uses wider steps for longer spans', () => {
    expect(clockTicks([1260, 1860])).toEqual([1320, 1440, 1560, 1680, 1800])
    expect(clockTicks([1380, 1680])).toEqual([1380, 1440, 1500, 1560, 1620, 1680])
  })
})

describe('scheduleStatsText', () => {
  it('formats means and spreads', () => {
    expect(
      scheduleStatsText({
        bedtime_mean_clock_min: 1270,
        bedtime_sd_min: 34.2,
        n: 20,
        wake_mean_clock_min: 340,
        wake_sd_min: 22,
      }),
    ).toBe('Bedtime 21:10 ± 34 min · Wake 05:40 ± 22 min')
  })

  it('is null without stats', () => {
    expect(
      scheduleStatsText({
        bedtime_mean_clock_min: null,
        bedtime_sd_min: null,
        n: 0,
        wake_mean_clock_min: null,
        wake_sd_min: null,
      }),
    ).toBeNull()
  })
})

describe('recommendationLines', () => {
  it('maps known codes to sentences', () => {
    expect(recommendationLines(rec({ recommendation: 'earlier_bedtime' }))).toEqual([
      'Oura suggests going to bed earlier',
    ])
    expect(recommendationLines(rec({ recommendation: 'later_wake_up_time' }))).toEqual([
      'Oura suggests waking up later',
    ])
  })

  it('names the optimal window', () => {
    expect(
      recommendationLines(
        rec({
          optimal: { date: '2026-10-24', end_clock_min: 1245, start_clock_min: 1200 },
          recommendation: 'follow_optimal_bedtime',
        }),
      ),
    ).toEqual(['Oura found an optimal bedtime window: 20:00–20:45'])
  })

  it('dates a window found earlier', () => {
    expect(
      recommendationLines(
        rec({
          last_optimal: { date: '2026-10-12', end_clock_min: 1245, start_clock_min: 1200 },
          recommendation: 'follow_optimal_bedtime',
        }),
      ),
    ).toEqual(['Oura found an optimal bedtime window: 20:00–20:45 (last found on Oct 12)'])
  })

  it('explains not having enough nights', () => {
    expect(recommendationLines(rec({ status: 'not_enough_nights' }))).toEqual([
      'Oura needs more nights to recommend a bedtime',
    ])
  })

  it('humanises unknown codes', () => {
    expect(recommendationLines(rec({ recommendation: 'some_new_code' }))).toEqual(['Some new code'])
    expect(humanise('earlier-bedtime')).toBe('Earlier bedtime')
  })

  it('is empty without a recommendation', () => {
    expect(recommendationLines(null)).toEqual([])
  })
})
