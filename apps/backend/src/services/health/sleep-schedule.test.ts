import { describe, expect, test } from 'vitest'

import type { SleepSessionRow } from '../../db/index.ts'

import { bedtimeClockMinutes, buildRecommendation, pickMainSleeps, scheduleStats } from './sleep-schedule.ts'

const TZ = 'Europe/Ljubljana'

const sleep = (start: string, end: string, over: Partial<SleepSessionRow> = {}): SleepSessionRow => ({
  end_time: new Date(end),
  oura_type: 'long_sleep',
  source: 'oura',
  start_time: new Date(start),
  ...over,
})

describe('bedtimeClockMinutes', () => {
  test('evening bedtimes stay, after-midnight bedtimes move past 1440', () => {
    expect(bedtimeClockMinutes(new Date('2026-06-01T20:30:00Z'), TZ)).toBe(1350)
    expect(bedtimeClockMinutes(new Date('2026-06-01T22:30:00Z'), TZ)).toBe(1470)
    expect(bedtimeClockMinutes(new Date('2026-06-01T09:59:00Z'), TZ)).toBe(719 + 1440)
    expect(bedtimeClockMinutes(new Date('2026-06-01T10:00:00Z'), TZ)).toBe(720)
  })
})

describe('pickMainSleeps', () => {
  test('across the spring DST change (2026-03-29)', () => {
    const [night] = pickMainSleeps([sleep('2026-03-28T22:00:00Z', '2026-03-29T05:00:00Z')], TZ)
    expect(night).toMatchObject({ bedtime_clock_min: 1380, date: '2026-03-29', wake_clock_min: 420 })
  })

  test('across the autumn DST change (2026-10-25)', () => {
    const [night] = pickMainSleeps([sleep('2026-10-24T22:30:00Z', '2026-10-25T06:00:00Z')], TZ)
    expect(night).toMatchObject({ bedtime_clock_min: 1470, date: '2026-10-25', wake_clock_min: 420 })
  })

  test("prefers Oura's long_sleep, else the longest sleep of the wake day", () => {
    const nights = pickMainSleeps(
      [
        sleep('2026-06-01T14:00:00Z', '2026-06-01T16:00:00Z', { oura_type: 'late_nap' }),
        sleep('2026-05-31T21:00:00Z', '2026-06-01T04:00:00Z'),
        sleep('2026-06-01T21:00:00Z', '2026-06-02T03:00:00Z', { oura_type: null, source: 'garmin' }),
        sleep('2026-06-01T20:00:00Z', '2026-06-02T05:00:00Z', { oura_type: null, source: 'health_connect' }),
      ],
      TZ,
    )
    expect(nights.map((n) => [n.date, n.bedtime_start])).toEqual([
      ['2026-06-01', '2026-05-31T21:00:00.000Z'],
      ['2026-06-02', '2026-06-01T20:00:00.000Z'],
    ])
  })
})

describe('scheduleStats', () => {
  test('mean and SD, null SD with one night, nulls with none', () => {
    const nights = pickMainSleeps(
      [
        sleep('2026-06-01T20:00:00Z', '2026-06-02T05:00:00Z'),
        sleep('2026-06-02T22:00:00Z', '2026-06-03T05:00:00Z'),
      ],
      TZ,
    )
    expect(scheduleStats(nights)).toEqual({
      bedtime_mean_clock_min: 1380,
      bedtime_sd_min: 84.9,
      n: 2,
      wake_mean_clock_min: 420,
      wake_sd_min: 0,
    })
    expect(scheduleStats(nights.slice(0, 1))).toMatchObject({
      bedtime_mean_clock_min: 1320,
      bedtime_sd_min: null,
    })
    expect(scheduleStats([])).toEqual({
      bedtime_mean_clock_min: null,
      bedtime_sd_min: null,
      n: 0,
      wake_mean_clock_min: null,
      wake_sd_min: null,
    })
  })
})

describe('buildRecommendation', () => {
  const optimal = { day_tz: 7200, end_offset: 1800, start_offset: -3600 }

  test('maps Oura offsets onto the clock scale', () => {
    expect(
      buildRecommendation(
        {
          day: '2026-10-20',
          optimal_bedtime: optimal,
          recommendation: 'follow_optimal_bedtime',
          status: 'optimal_found',
        },
        null,
      ),
    ).toEqual({
      date: '2026-10-20',
      last_optimal: null,
      optimal: { date: '2026-10-20', end_clock_min: 1470, start_clock_min: 1380 },
      recommendation: 'follow_optimal_bedtime',
      status: 'optimal_found',
    })
  })

  test('falls back to the last day with an optimal window', () => {
    const out = buildRecommendation(
      { day: '2026-10-20', optimal_bedtime: null, recommendation: null, status: 'not_enough_nights' },
      {
        day: '2026-10-10',
        optimal_bedtime: { ...optimal, start_offset: -14400 },
        recommendation: null,
        status: 'x',
      },
    )
    expect(out).toMatchObject({
      last_optimal: { date: '2026-10-10', end_clock_min: 1470, start_clock_min: 1200 },
      optimal: null,
    })
  })

  test('null without records', () => {
    expect(buildRecommendation(null, null)).toBeNull()
  })
})
