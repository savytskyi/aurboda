import type {
  HealthDailyPoint,
  HealthScoreSummary,
  HealthSignalSummary,
  HealthStressSummary,
} from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { buildHealthInsights, type InsightInputs } from './insights.ts'

const DATE = '2026-10-20'

const normals = {
  hrv_sleep: { mean: 40, sd: 5 },
  resting_heart_rate: { mean: 50, sd: 2 },
  respiratory_rate: { mean: 14, sd: 0.3 },
  temperature_deviation: { mean: 0, sd: 0.2 },
} as const

type SignalMetric = keyof typeof normals

/** A signal whose value sits `z` SDs from its normal. */
const signal = (metric: SignalMetric, z: number | null): HealthSignalSummary => {
  const { mean, sd } = normals[metric]
  if (z === null) {
    return {
      baseline: null,
      date: DATE,
      delta: null,
      favorable: null,
      metric,
      status: 'insufficient_data',
      value: mean,
      z: null,
    }
  }
  const value = mean + z * sd
  return {
    baseline: { mean, n: 30, sd },
    date: DATE,
    delta: value - mean,
    favorable: null,
    metric,
    status: 'normal',
    value,
    z,
  }
}

const readiness = (z: number | null): HealthScoreSummary => ({
  baseline: z === null ? null : { mean: 75, n: 30, sd: 5 },
  date: DATE,
  delta: z === null ? null : z * 5,
  details: [],
  metric: 'readiness_score',
  value: 75 + (z ?? 0) * 5,
  weakest_contributors: [],
})

const stress = (over: Partial<HealthStressSummary> = {}): HealthStressSummary => ({
  date: DATE,
  day_summary: null,
  day_summary_date: null,
  is_partial_day: false,
  recovery_high_sec: null,
  resilience: {
    contributors: { daytime_recovery: null, sleep_recovery: null, stress: null },
    date: null,
    level: null,
    previous_level: null,
  },
  stress_high_sec: null,
  stressful_days_last_7: 0,
  ...over,
})

const sleepNights = (dates: string[], hours: number, normalHours = 7.5, sdHours = 0.5): HealthDailyPoint[] =>
  dates.map((date) => ({
    baseline: { mean: normalHours * 3600, n: 30, sd: sdHours * 3600 },
    date,
    value: hours * 3600,
  }))

const recentSleep = sleepNights(['2026-10-19', DATE], 7.5)

const inputs = (over: {
  signals?: Partial<Record<SignalMetric, number | null>>
  readinessZ?: number | null
  stress?: Partial<HealthStressSummary>
  series?: Record<string, HealthDailyPoint[]>
}): InsightInputs => {
  const zs = {
    hrv_sleep: 0,
    resting_heart_rate: 0,
    respiratory_rate: 0,
    temperature_deviation: 0,
    ...over.signals,
  }
  return {
    date: DATE,
    readiness: readiness(over.readinessZ ?? 0),
    series: new Map(Object.entries({ sleep_duration_sec: recentSleep, ...over.series })),
    signals: (Object.keys(normals) as SignalMetric[]).map((m) => signal(m, zs[m])),
    stress: stress(over.stress),
  }
}

const ids = (i: InsightInputs) => buildHealthInsights(i).map((x) => x.id)

describe('buildHealthInsights', () => {
  test('nothing fires on a normal day', () => {
    expect(buildHealthInsights(inputs({}))).toEqual([])
  })

  describe('recovery_strain', () => {
    test('fires on two off signals and suppresses their single-signal rules', () => {
      const out = buildHealthInsights(inputs({ signals: { hrv_sleep: -2, resting_heart_rate: 2 } }))
      expect(out.map((x) => x.id)).toEqual(['recovery_strain'])
      expect(out[0]).toMatchObject({
        href: '/health/recovery',
        metrics: ['hrv_sleep', 'resting_heart_rate'],
        severity: 'alert',
        title: 'Several recovery signals are off your normal',
      })
      expect(out[0]!.detail).toContain('your normal')
      expect(out[0]!.detail).toContain('This is not a diagnosis.')
    })

    test('does not fire on one off signal', () => {
      expect(ids(inputs({ signals: { hrv_sleep: -2 } }))).toEqual(['hrv_low'])
    })

    test('temperature counts only at ≥ +0.5 °C and z ≥ 2', () => {
      expect(ids(inputs({ signals: { hrv_sleep: -2, temperature_deviation: 2.5 } }))).toEqual([
        'recovery_strain',
      ])
      expect(ids(inputs({ signals: { hrv_sleep: -2, temperature_deviation: 2 } }))).toEqual(['hrv_low'])
    })

    test('every off signal joins the strain', () => {
      const out = buildHealthInsights(
        inputs({ signals: { hrv_sleep: -2, respiratory_rate: 2.5, resting_heart_rate: 1.6 } }),
      )
      expect(out.map((x) => x.id)).toEqual(['recovery_strain'])
      expect(out[0]!.metrics).toEqual(['hrv_sleep', 'resting_heart_rate', 'respiratory_rate'])
    })

    test('a metric outside the strain keeps its own rule', () => {
      const hrv = ['2026-10-18', '2026-10-19', DATE].map((date) => ({
        baseline: { mean: 40, n: 30, sd: 5 },
        date,
        value: 34,
      }))
      const out = ids(
        inputs({
          series: { hrv_sleep: hrv },
          signals: { hrv_sleep: -1.2, resting_heart_rate: 2, temperature_deviation: 2.5 },
        }),
      )
      expect(out).toEqual(['recovery_strain', 'hrv_low'])
    })

    test('needs a baseline', () => {
      expect(ids(inputs({ signals: { hrv_sleep: null, resting_heart_rate: null } }))).toEqual([])
    })
  })

  describe('hrv_low', () => {
    test('fires at z = −1.5 and not at −1.4', () => {
      expect(ids(inputs({ signals: { hrv_sleep: -1.5 } }))).toEqual(['hrv_low'])
      expect(ids(inputs({ signals: { hrv_sleep: -1.4 } }))).toEqual([])
    })

    test('fires when each of the last 3 nights is below mean − 1 SD', () => {
      const hrv = ['2026-10-18', '2026-10-19', DATE].map((date) => ({
        baseline: { mean: 40, n: 30, sd: 5 },
        date,
        value: 34,
      }))
      expect(ids(inputs({ series: { hrv_sleep: hrv }, signals: { hrv_sleep: -1.2 } }))).toEqual(['hrv_low'])
      const gap = hrv.filter((p) => p.date !== '2026-10-19')
      expect(ids(inputs({ series: { hrv_sleep: gap }, signals: { hrv_sleep: -1.2 } }))).toEqual([])
    })
  })

  describe('rhr_high', () => {
    test('needs z ≥ 1.5 and at least +3 bpm', () => {
      expect(ids(inputs({ signals: { resting_heart_rate: 1.5 } }))).toEqual(['rhr_high'])
      expect(ids(inputs({ signals: { resting_heart_rate: 1.4 } }))).toEqual([])
      const narrow = inputs({ signals: { resting_heart_rate: 2 } })
      const rhr = narrow.signals.find((s) => s.metric === 'resting_heart_rate')!
      Object.assign(rhr, { baseline: { mean: 50, n: 30, sd: 1 }, delta: 2, value: 52, z: 2 })
      expect(ids(narrow)).toEqual([])
    })
  })

  describe('temperature_high', () => {
    test('needs ≥ +0.5 °C and z ≥ 2', () => {
      expect(ids(inputs({ signals: { temperature_deviation: 2.5 } }))).toEqual(['temperature_high'])
      expect(ids(inputs({ signals: { temperature_deviation: 2 } }))).toEqual([])
    })
  })

  describe('respiratory_high', () => {
    test('needs z ≥ 2 and at least +0.7 brpm', () => {
      expect(ids(inputs({ signals: { respiratory_rate: 2.4 } }))).toEqual(['respiratory_high'])
      expect(ids(inputs({ signals: { respiratory_rate: 2.2 } }))).toEqual([])
    })
  })

  describe('short_sleep', () => {
    const dates = ['2026-10-18', '2026-10-19', DATE]

    test('fires when the 3-night mean is below normal − 1 SD', () => {
      const out = buildHealthInsights(inputs({ series: { sleep_duration_sec: sleepNights(dates, 6.9) } }))
      expect(out.map((x) => x.id)).toEqual(['short_sleep'])
      expect(out[0]!.href).toBe('/sleep')
      expect(out[0]!.detail).toContain('6.9 h')
      expect(out[0]!.detail).toContain('7.5 h')
    })

    test('does not fire at exactly normal − 1 SD', () => {
      expect(ids(inputs({ series: { sleep_duration_sec: sleepNights(dates, 7) } }))).toEqual([])
    })

    test('needs 3 nights within the last 4 days', () => {
      const two = sleepNights(['2026-10-19', DATE], 5)
      expect(ids(inputs({ series: { sleep_duration_sec: two } }))).toEqual([])
      const spread = sleepNights(['2026-10-17', '2026-10-19', DATE], 5)
      expect(ids(inputs({ series: { sleep_duration_sec: spread } }))).toEqual(['short_sleep'])
    })
  })

  describe('stressful_stretch', () => {
    test('fires at 3 stressful days, not at 2', () => {
      expect(ids(inputs({ stress: { stressful_days_last_7: 3 } }))).toEqual(['stressful_stretch'])
      expect(ids(inputs({ stress: { stressful_days_last_7: 2 } }))).toEqual([])
    })
  })

  describe('resilience_drop', () => {
    const resilience = (level: 'solid' | 'strong', previous: 'solid' | 'strong') => ({
      resilience: {
        contributors: { daytime_recovery: null, sleep_recovery: null, stress: null },
        date: DATE,
        level,
        previous_level: previous,
      },
    })

    test('fires on a one-step drop, not when level is unchanged', () => {
      expect(ids(inputs({ stress: resilience('solid', 'strong') }))).toEqual(['resilience_drop'])
      expect(ids(inputs({ stress: resilience('solid', 'solid') }))).toEqual([])
      expect(ids(inputs({ stress: resilience('strong', 'solid') }))).toEqual([])
    })
  })

  describe('no_recent_sleep', () => {
    test('fires with no sleep on the day or the day before', () => {
      const old = sleepNights(['2026-10-15'], 7)
      expect(ids(inputs({ series: { sleep_duration_sec: old } }))).toEqual(['no_recent_sleep'])
    })

    test('does not fire when the previous day has sleep, or the user has no sleep data at all', () => {
      expect(ids(inputs({ series: { sleep_duration_sec: sleepNights(['2026-10-19'], 7.5) } }))).toEqual([])
      expect(ids(inputs({ series: { sleep_duration_sec: [] } }))).toEqual([])
    })
  })

  describe('well_recovered', () => {
    test('fires with readiness z ≥ 1 and HRV z ≥ 0.5', () => {
      const out = buildHealthInsights(inputs({ readinessZ: 1, signals: { hrv_sleep: 0.5 } }))
      expect(out.map((x) => x.id)).toEqual(['well_recovered'])
      expect(out[0]!.severity).toBe('positive')
    })

    test('does not fire below the thresholds', () => {
      expect(ids(inputs({ readinessZ: 0.9, signals: { hrv_sleep: 1 } }))).toEqual([])
      expect(ids(inputs({ readinessZ: 2, signals: { hrv_sleep: 0.4 } }))).toEqual([])
    })

    test('is suppressed by any watch insight', () => {
      expect(
        ids(inputs({ readinessZ: 2, signals: { hrv_sleep: 1 }, stress: { stressful_days_last_7: 4 } })),
      ).toEqual(['stressful_stretch'])
    })
  })

  test('caps at three, ordered by severity then |z|', () => {
    const out = ids(
      inputs({
        series: { sleep_duration_sec: sleepNights(['2026-10-15'], 7) },
        signals: { resting_heart_rate: 1.6, respiratory_rate: 3, temperature_deviation: 2.6 },
        stress: {
          resilience: {
            contributors: { daytime_recovery: null, sleep_recovery: null, stress: null },
            date: DATE,
            level: 'limited',
            previous_level: 'solid',
          },
          stressful_days_last_7: 5,
        },
      }),
    )
    expect(out).toEqual(['recovery_strain', 'stressful_stretch', 'resilience_drop'])

    const watches = ids(
      inputs({
        series: { sleep_duration_sec: sleepNights(['2026-10-15'], 7) },
        signals: { hrv_sleep: -1.6, resting_heart_rate: 1.4 },
        stress: { stressful_days_last_7: 5 },
      }),
    )
    expect(watches).toEqual(['hrv_low', 'stressful_stretch', 'no_recent_sleep'])
  })

  test('watch insights sort by |z| descending', () => {
    const out = ids(inputs({ signals: { resting_heart_rate: 1.6 } }))
    expect(out).toEqual(['rhr_high'])
    const both = ids(
      inputs({
        signals: { resting_heart_rate: 3 },
        series: { sleep_duration_sec: sleepNights(['2026-10-18', '2026-10-19', DATE], 6.5) },
      }),
    )
    expect(both).toEqual(['rhr_high', 'short_sleep'])
    const flipped = ids(
      inputs({
        signals: { resting_heart_rate: 1.6 },
        series: { sleep_duration_sec: sleepNights(['2026-10-18', '2026-10-19', DATE], 6) },
      }),
    )
    expect(flipped).toEqual(['short_sleep', 'rhr_high'])
  })
})
