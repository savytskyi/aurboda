import { describe, expect, it } from 'vitest'

import {
  addDays,
  baselineDeltaTone,
  axisTickLabel,
  clockLabel,
  dateWithYear,
  deltaTone,
  formatDelta,
  formatDuration,
  formatMetricRange,
  formatMetricValue,
  metricLabel,
  normalBounds,
  shortDate,
} from './format'

describe('formatDuration', () => {
  it('uses hours and minutes from one hour up', () => {
    expect(formatDuration(7 * 3600 + 32 * 60)).toBe('7h 32m')
    expect(formatDuration(8 * 3600)).toBe('8h')
  })

  it('uses minutes below an hour', () => {
    expect(formatDuration(14 * 60)).toBe('14 min')
    expect(formatDuration(59 * 60 + 40)).toBe('1h')
  })
})

describe('formatMetricValue', () => {
  it('formats seconds as durations, latency in minutes', () => {
    expect(formatMetricValue('sleep_duration_sec', 27_120)).toBe('7h 32m')
    expect(formatMetricValue('sleep_latency_sec', 840)).toBe('14 min')
  })

  it('always signs temperature with one decimal', () => {
    expect(formatMetricValue('temperature_deviation', 0.2)).toBe('+0.2 °C')
    expect(formatMetricValue('temperature_deviation', -0.24)).toBe('−0.2 °C')
    expect(formatMetricValue('temperature_deviation', 0)).toBe('+0.0 °C')
  })

  it('formats heart and breathing units', () => {
    expect(formatMetricValue('hrv_sleep', 42.4)).toBe('42 ms')
    expect(formatMetricValue('resting_heart_rate', 52)).toBe('52 bpm')
    expect(formatMetricValue('sleep_average_heart_rate', 55.36)).toBe('55.4 bpm')
    expect(formatMetricValue('respiratory_rate', 14)).toBe('14.0 /min')
  })

  it('formats percentages, SpO₂ with one decimal', () => {
    expect(formatMetricValue('sleep_efficiency_percent', 91.6)).toBe('92%')
    expect(formatMetricValue('spo2', 97.84)).toBe('97.8%')
  })

  it('groups counts and converts metres to km', () => {
    expect(formatMetricValue('steps', 12_345)).toBe('12,345')
    expect(formatMetricValue('equivalent_walking_distance', 8_450)).toBe('8.5 km')
    expect(formatMetricValue('equivalent_walking_distance', 850)).toBe('850 m')
  })

  it('rounds scores and years to integers', () => {
    expect(formatMetricValue('readiness_score', 81.6)).toBe('82')
    expect(formatMetricValue('cardiovascular_age', 41.2)).toBe('41 years')
  })

  it('renders missing values as a dash, never 0', () => {
    expect(formatMetricValue('steps', null)).toBe('—')
    expect(formatMetricValue('steps', undefined)).toBe('—')
    expect(formatMetricValue('steps', Number.NaN)).toBe('—')
  })
})

describe('formatMetricRange', () => {
  it('puts the unit after the upper bound', () => {
    expect(formatMetricRange('hrv_sleep', 26.2, 33.4)).toBe('26–33 ms')
    expect(formatMetricRange('sleep_duration_sec', 25_200, 28_800)).toBe('7h–8h')
  })
})

describe('formatDelta', () => {
  it('uses arrows and the metric unit', () => {
    expect(formatDelta('hrv_sleep', 3.2)).toBe('↑ 3 ms')
    expect(formatDelta('sleep_duration_sec', -720)).toBe('↓ 12 min')
    expect(formatDelta('temperature_deviation', -0.3)).toBe('↓ 0.3 °C')
    expect(formatDelta('readiness_score', 4)).toBe('↑ 4')
  })

  it('says no change when the delta rounds to zero', () => {
    expect(formatDelta('readiness_score', 0.2)).toBe('No change')
    expect(formatDelta('sleep_duration_sec', 20)).toBe('No change')
  })

  it('renders a missing delta as a dash', () => {
    expect(formatDelta('readiness_score', null)).toBe('—')
  })
})

describe('deltaTone', () => {
  it('follows the catalog direction', () => {
    expect(deltaTone('hrv_sleep', 5)).toBe('good')
    expect(deltaTone('hrv_sleep', -5)).toBe('bad')
    expect(deltaTone('resting_heart_rate', -2)).toBe('good')
    expect(deltaTone('resting_heart_rate', 2)).toBe('bad')
  })

  it('is neutral for neutral metrics, tiny deltas and missing values', () => {
    expect(deltaTone('temperature_deviation', 0.5)).toBe('neutral')
    expect(deltaTone('respiratory_rate', 1)).toBe('neutral')
    expect(deltaTone('hrv_sleep', 0.1)).toBe('neutral')
    expect(deltaTone('hrv_sleep', null)).toBe('neutral')
    expect(deltaTone('unknown_metric', 5)).toBe('neutral')
  })
})

describe('clockLabel', () => {
  it('formats minutes after midnight, modulo a day', () => {
    expect(clockLabel(1350)).toBe('22:30')
    expect(clockLabel(1470)).toBe('00:30')
    expect(clockLabel(340)).toBe('05:40')
    expect(clockLabel(-30)).toBe('23:30')
    expect(clockLabel(1440 * 2 + 5)).toBe('00:05')
  })
})

describe('helpers', () => {
  it('labels metrics from the catalog', () => {
    expect(metricLabel('hrv_sleep')).toBe('Nightly HRV')
    expect(metricLabel('something_else')).toBe('something_else')
  })

  it('formats axis ticks compactly', () => {
    expect(axisTickLabel('sleep_duration_sec', 27_000)).toBe('7.5h')
    expect(axisTickLabel('steps', 12_000)).toBe('12K')
    expect(axisTickLabel('hrv_sleep', 40)).toBe('40')
  })

  it('does day arithmetic on local calendar days', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(shortDate('2026-10-22')).toBe('Oct 22')
    expect(dateWithYear('2025-01-03')).toBe('Jan 3, 2025')
  })
})

describe('normalBounds', () => {
  const baseline = { mean: 0.4, n: 30, sd: 0.7 }
  it('stops at 0 for quantities that cannot be negative', () => {
    expect(normalBounds('breathing_disturbance_index', baseline)).toEqual({ hi: 1.1, lo: 0 })
  })
  it('keeps negative bounds for signed deviations', () => {
    expect(normalBounds('temperature_deviation', baseline).lo).toBeCloseTo(-0.3)
  })
})

describe('baselineDeltaTone', () => {
  const baseline = { mean: 88, n: 30, sd: 6 }
  it('stays neutral within half a standard deviation', () => {
    expect(baselineDeltaTone('activity_score', -2, baseline)).toBe('neutral')
  })
  it('colours larger differences by direction', () => {
    expect(baselineDeltaTone('activity_score', -4, baseline)).toBe('bad')
    expect(baselineDeltaTone('resting_heart_rate', -4, baseline)).toBe('good')
  })
  it('falls back to deltaTone without a baseline', () => {
    expect(baselineDeltaTone('activity_score', -2, null)).toBe('bad')
  })
})
