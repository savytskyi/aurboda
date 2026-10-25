import type { HealthDailyPoint } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  buildHealthOverview,
  buildScoreSummary,
  buildSignalSummary,
  buildStressSummary,
  computeAge,
  decodeResilience,
  latestPoint,
} from './overview.ts'

const DATE = '2026-10-20'
const baseline = { mean: 50, n: 30, sd: 4 }
const pt = (date: string, value: number, b: HealthDailyPoint['baseline'] = baseline): HealthDailyPoint => ({
  baseline: b,
  date,
  value,
})

describe('latestPoint', () => {
  const points = [pt('2026-10-15', 1), pt('2026-10-18', 2), pt('2026-10-21', 3)]

  test('takes the day itself, else the latest within the two days before', () => {
    expect(latestPoint(points, '2026-10-18')?.value).toBe(2)
    expect(latestPoint(points, '2026-10-20')?.value).toBe(2)
    expect(latestPoint(points, '2026-10-17')?.value).toBe(1)
    expect(latestPoint([pt('2026-10-15', 1)], '2026-10-18')).toBeUndefined()
  })
})

describe('buildScoreSummary', () => {
  test('value, delta, details and the two weakest contributors below 70 on the same day', () => {
    const series = new Map([
      ['sleep_score', [pt('2026-10-19', 58)]],
      ['sleep_duration_sec', [pt('2026-10-19', 21600)]],
      ['sleep_efficiency', [pt('2026-10-19', 69)]],
      ['sleep_deep_score', [pt('2026-10-19', 40)]],
      ['sleep_latency', [pt('2026-10-19', 55), pt(DATE, 10)]],
      ['sleep_timing', [pt('2026-10-19', 90)]],
    ])
    expect(buildScoreSummary(series, 'sleep_score', DATE)).toEqual({
      baseline,
      date: '2026-10-19',
      delta: 8,
      details: [{ metric: 'sleep_duration_sec', value: 21600 }],
      metric: 'sleep_score',
      value: 58,
      weakest_contributors: [
        { metric: 'sleep_deep_score', value: 40 },
        { metric: 'sleep_latency', value: 55 },
      ],
    })
  })

  test('missing score', () => {
    expect(buildScoreSummary(new Map(), 'readiness_score', DATE)).toMatchObject({ date: null, value: null })
  })
})

describe('buildSignalSummary', () => {
  test.each([
    ['hrv_sleep', 44, 'below', false],
    ['hrv_sleep', 56, 'above', true],
    ['resting_heart_rate', 56, 'above', false],
    ['resting_heart_rate', 44, 'below', true],
    ['respiratory_rate', 56, 'above', null],
    ['hrv_sleep', 55, 'normal', null],
  ] as const)('%s %d → %s, favorable %s', (metric, value, status, favorable) => {
    const s = buildSignalSummary(new Map([[metric, [pt(DATE, value)]]]), metric, DATE)
    expect(s).toMatchObject({ favorable, status, z: (value - 50) / 4 })
  })

  test('missing and insufficient data', () => {
    expect(buildSignalSummary(new Map(), 'hrv_sleep', DATE).status).toBe('missing')
    const s = buildSignalSummary(new Map([['hrv_sleep', [pt(DATE, 40, null)]]]), 'hrv_sleep', DATE)
    expect(s).toMatchObject({ baseline: null, favorable: null, status: 'insufficient_data', z: null })
  })
})

describe('buildStressSummary', () => {
  test('totals fall back to the latest day; summary and stressful days look back 7 days; resilience vs 14 days ago', () => {
    const series = new Map([
      ['stress_high_sec', [pt('2026-10-19', 3600)]],
      ['recovery_high_sec', [pt('2026-10-19', 1800)]],
      [
        'stress_day_summary',
        [
          pt('2026-10-13', 3),
          pt('2026-10-14', 3),
          pt('2026-10-16', 3),
          pt('2026-10-17', 1),
          pt('2026-10-18', 3),
        ],
      ],
      ['resilience_score', [pt('2026-10-04', 80), pt('2026-10-18', 60)]],
      ['resilience_stress', [pt('2026-10-18', 45)]],
    ])
    expect(buildStressSummary(series, DATE, DATE)).toEqual({
      date: '2026-10-19',
      day_summary: 'stressful',
      day_summary_date: '2026-10-18',
      is_partial_day: false,
      recovery_high_sec: 1800,
      resilience: {
        contributors: { daytime_recovery: null, sleep_recovery: null, stress: 45 },
        date: '2026-10-18',
        level: 'solid',
        previous_level: 'strong',
      },
      stress_high_sec: 3600,
      stressful_days_last_7: 3,
    })
  })

  test("today's totals are partial", () => {
    const series = new Map([['stress_high_sec', [pt(DATE, 600)]]])
    expect(buildStressSummary(series, DATE, DATE)).toMatchObject({
      is_partial_day: true,
      recovery_high_sec: null,
    })
  })

  test('decodes resilience levels', () => {
    expect([20, 40, 60, 80, 100].map(decodeResilience)).toEqual([
      'limited',
      'adequate',
      'solid',
      'strong',
      'exceptional',
    ])
    expect(decodeResilience(undefined)).toBeNull()
  })
})

describe('computeAge', () => {
  test('prefers birth_date, in whole years', () => {
    expect(computeAge({ birthDate: '1980-10-21' }, DATE, 'UTC')).toEqual({
      as_of: DATE,
      source: 'birth_date',
      years: 45,
    })
  })

  test('else Oura personal_info advanced by the years since it was fetched', () => {
    const ouraPersonalInfo = { age: 44, received_at: new Date('2024-06-01T10:00:00Z') }
    expect(computeAge({ birthDate: null, ouraPersonalInfo }, DATE, 'UTC')).toEqual({
      as_of: DATE,
      source: 'oura_personal_info',
      years: 46,
    })
  })

  test('null without either', () => {
    expect(computeAge({}, DATE, 'UTC')).toBeNull()
  })
})

describe('buildHealthOverview', () => {
  test('assembles scores, signals in order, stress and last sleep date', () => {
    const series = new Map([
      ['readiness_score', [pt(DATE, 80)]],
      ['sleep_duration_sec', [pt('2026-10-19', 25000), pt(DATE, 26000)]],
      ['hrv_sleep', [pt(DATE, 50)]],
    ])
    const out = buildHealthOverview({ age: null, date: DATE, series, today: DATE, tz: 'UTC' })
    expect(out.signals.map((s) => s.metric)).toEqual([
      'hrv_sleep',
      'resting_heart_rate',
      'temperature_deviation',
      'respiratory_rate',
    ])
    expect(out.scores.readiness.value).toBe(80)
    expect(out.scores.activity.value).toBeNull()
    expect(out.last_sleep_date).toBe(DATE)
    expect(out.insights).toEqual([])
  })
})
