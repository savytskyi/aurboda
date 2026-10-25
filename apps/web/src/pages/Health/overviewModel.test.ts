import type { HealthScoreSummary, HealthSignalSummary, HealthStressSummary } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  daySummaryChip,
  lastNightCaption,
  normalRangeText,
  resilienceText,
  scoreContext,
  signalChip,
  stressSplit,
  targetProgress,
  valueDateNote,
} from './overviewModel'

const score = (overrides: Partial<HealthScoreSummary>): HealthScoreSummary => ({
  baseline: null,
  date: '2026-10-24',
  delta: null,
  details: [],
  metric: 'readiness_score',
  value: 80,
  weakest_contributors: [],
  ...overrides,
})

const signal = (overrides: Partial<HealthSignalSummary>): HealthSignalSummary => ({
  baseline: { mean: 30, n: 30, sd: 3 },
  date: '2026-10-24',
  delta: 0,
  favorable: null,
  metric: 'hrv_sleep',
  status: 'normal',
  value: 30,
  z: 0,
  ...overrides,
})

const stress = (overrides: Partial<HealthStressSummary>): HealthStressSummary => ({
  date: '2026-10-24',
  day_summary: null,
  day_summary_date: null,
  is_partial_day: true,
  recovery_high_sec: null,
  resilience: {
    contributors: { daytime_recovery: null, sleep_recovery: null, stress: null },
    date: null,
    level: null,
    previous_level: null,
  },
  stress_high_sec: null,
  stressful_days_last_7: 0,
  ...overrides,
})

describe('scoreContext', () => {
  it('names the weakest readiness contributor', () => {
    const summary = score({ weakest_contributors: [{ metric: 'readiness_hrv_balance', value: 54 }] })
    expect(scoreContext('readiness', summary)).toBe('Lowest: HRV balance 54')
  })

  it('says all is well without weak contributors', () => {
    expect(scoreContext('readiness', score({}))).toBe('All contributors in good shape')
  })

  it('summarises sleep duration and efficiency', () => {
    const summary = score({
      details: [
        { metric: 'sleep_duration_sec', value: 27_120 },
        { metric: 'sleep_efficiency_percent', value: 91.4 },
      ],
      metric: 'sleep_score',
    })
    expect(scoreContext('sleep', summary)).toBe('7h 32m asleep · 91% efficiency')
  })

  it('summarises steps and target progress, omitting what is missing', () => {
    const full = score({
      details: [
        { metric: 'steps', value: 8_432 },
        { metric: 'equivalent_walking_distance', value: 6_000 },
        { metric: 'activity_target_meters', value: 8_000 },
      ],
      metric: 'activity_score',
    })
    expect(scoreContext('activity', full)).toBe('8,432 steps · 75% of daily target')
    const stepsOnly = score({ details: [{ metric: 'steps', value: 100 }], metric: 'activity_score' })
    expect(scoreContext('activity', stepsOnly)).toBe('100 steps')
    expect(scoreContext('activity', score({ metric: 'activity_score' }))).toBeNull()
  })

  it('has no context without a value', () => {
    expect(scoreContext('readiness', score({ value: null }))).toBeNull()
  })
})

describe('targetProgress', () => {
  it('needs both distance and a positive target', () => {
    expect(
      targetProgress(score({ details: [{ metric: 'equivalent_walking_distance', value: 5 }] })),
    ).toBeNull()
    expect(
      targetProgress(
        score({
          details: [
            { metric: 'equivalent_walking_distance', value: 5 },
            { metric: 'activity_target_meters', value: 0 },
          ],
        }),
      ),
    ).toBeNull()
    expect(
      targetProgress(
        score({
          details: [
            { metric: 'equivalent_walking_distance', value: 12_000 },
            { metric: 'activity_target_meters', value: 10_000 },
          ],
        }),
      ),
    ).toBe(120)
  })
})

describe('dates', () => {
  it('notes a value from another day', () => {
    expect(valueDateNote('2026-10-22', '2026-10-24')).toBe('from Oct 22')
    expect(valueDateNote('2026-10-24', '2026-10-24')).toBeNull()
    expect(valueDateNote(null, '2026-10-24')).toBeNull()
  })

  it('describes last night', () => {
    expect(lastNightCaption('2026-10-24', '2026-10-24')).toBe('Last night: woke Oct 24')
    expect(lastNightCaption(null, '2026-10-24')).toBe('No sleep recorded for last night')
    expect(lastNightCaption('2026-10-21', '2026-10-24')).toBe(
      'No sleep recorded for last night (latest: Oct 21)',
    )
  })
})

describe('signalChip', () => {
  it('marks normal as good', () => {
    expect(signalChip(signal({}))).toEqual({ label: 'Normal', tone: 'good' })
  })

  it('marks favourable deviations good and others watch', () => {
    expect(signalChip(signal({ favorable: true, status: 'above' }))).toEqual({
      icon: '▲',
      label: 'Above normal',
      tone: 'good',
    })
    expect(signalChip(signal({ favorable: false, status: 'below' }))).toEqual({
      icon: '▼',
      label: 'Below normal',
      tone: 'watch',
    })
    expect(
      signalChip(signal({ favorable: null, metric: 'temperature_deviation', status: 'above' })).tone,
    ).toBe('watch')
  })

  it('covers building baseline and missing data', () => {
    expect(signalChip(signal({ status: 'insufficient_data' }))).toEqual({
      label: 'Building baseline',
      tone: 'info',
    })
    expect(signalChip(signal({ status: 'missing' }))).toEqual({ label: 'No data', tone: 'info' })
  })
})

describe('normalRangeText', () => {
  it('rounds mean ± sd', () => {
    expect(normalRangeText('hrv_sleep', { mean: 29.6, n: 30, sd: 3.4 })).toBe('normal 26–33 ms')
    expect(normalRangeText('hrv_sleep', null)).toBeNull()
  })
})

describe('stressSplit', () => {
  it('splits into whole percentages summing to 100', () => {
    expect(stressSplit({ recovery_high_sec: 3600, stress_high_sec: 1800 })).toEqual({
      restorativePercent: 67,
      restorativeSec: 3600,
      stressPercent: 33,
      stressSec: 1800,
    })
  })

  it('treats a missing side as zero and returns null without any time', () => {
    expect(stressSplit({ recovery_high_sec: null, stress_high_sec: 600 })?.stressPercent).toBe(100)
    expect(stressSplit({ recovery_high_sec: null, stress_high_sec: null })).toBeNull()
    expect(stressSplit({ recovery_high_sec: 0, stress_high_sec: 0 })).toBeNull()
  })
})

describe('daySummaryChip', () => {
  it('labels the summary and dates it when not today', () => {
    expect(
      daySummaryChip(stress({ day_summary: 'restored', day_summary_date: '2026-10-24' }), '2026-10-24'),
    ).toEqual({ label: 'Restored', tone: 'positive' })
    expect(
      daySummaryChip(stress({ day_summary: 'stressful', day_summary_date: '2026-10-23' }), '2026-10-24'),
    ).toEqual({ label: 'Stressful (Oct 23)', tone: 'watch' })
    expect(daySummaryChip(stress({}), '2026-10-24')).toBeNull()
  })
})

describe('resilienceText', () => {
  it('describes the level and its two-week change', () => {
    expect(resilienceText('solid', 'solid')).toBe('Solid · steady for 2 weeks')
    expect(resilienceText('solid', 'adequate')).toBe('Solid · ↑ from Adequate 2 weeks ago')
    expect(resilienceText('limited', 'strong')).toBe('Limited · ↓ from Strong 2 weeks ago')
    expect(resilienceText('strong', null)).toBe('Strong')
    expect(resilienceText(null, 'strong')).toBeNull()
  })
})
