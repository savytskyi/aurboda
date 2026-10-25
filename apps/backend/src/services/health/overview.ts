import {
  activityContributorMetrics,
  type HealthAge,
  type HealthDailyPoint,
  type HealthMetric,
  healthMetricCatalog,
  type HealthOverviewData,
  type HealthScoreSummary,
  type HealthSignalStatus,
  type HealthSignalSummary,
  type HealthStressSummary,
  type HealthValue,
  readinessContributorMetrics,
  type ResilienceLevel,
  resilienceLevels,
  sleepContributorMetrics,
  type StressDaySummary,
} from '@aurboda/api-spec'

import { getLatestOuraPersonalInfo } from '../../db/index.ts'
import { getSettings } from '../settings.ts'
import { fetchDailySeries } from './daily.ts'
import { addDays, localDateOf, todayIn, wholeYearsBetween } from './days.ts'
import { buildHealthInsights } from './insights.ts'

export const OVERVIEW_BASELINE_DAYS = 30
const OVERVIEW_HISTORY_DAYS = 30
const LATEST_LOOKBACK_DAYS = 2
const WEAK_CONTRIBUTOR_BELOW = 70
const SIGNAL_Z = 1.5

export const signalMetrics = [
  'hrv_sleep',
  'resting_heart_rate',
  'temperature_deviation',
  'respiratory_rate',
] as const

const scoreDetails = {
  activity_score: ['steps', 'equivalent_walking_distance', 'activity_target_meters'],
  readiness_score: [],
  sleep_score: ['sleep_duration_sec', 'sleep_efficiency_percent'],
} as const

const scoreContributors = {
  activity_score: activityContributorMetrics,
  readiness_score: readinessContributorMetrics,
  sleep_score: sleepContributorMetrics,
} as const

type ScoreMetric = keyof typeof scoreDetails

export const overviewMetrics: HealthMetric[] = [
  'readiness_score',
  'sleep_score',
  'activity_score',
  ...readinessContributorMetrics,
  ...sleepContributorMetrics,
  ...activityContributorMetrics,
  ...signalMetrics,
  'sleep_duration_sec',
  'sleep_efficiency_percent',
  'steps',
  'equivalent_walking_distance',
  'activity_target_meters',
  'stress_high_sec',
  'recovery_high_sec',
  'stress_day_summary',
  'resilience_score',
  'resilience_sleep_recovery',
  'resilience_daytime_recovery',
  'resilience_stress',
]

export type OverviewSeries = ReadonlyMap<string, HealthDailyPoint[]>

const pointsOf = (series: OverviewSeries, metric: string): HealthDailyPoint[] => series.get(metric) ?? []

/** Value on `date`, else the most recent within `lookbackDays` before it. */
export const latestPoint = (
  points: HealthDailyPoint[],
  date: string,
  lookbackDays: number = LATEST_LOOKBACK_DAYS,
): HealthDailyPoint | undefined => {
  const from = addDays(date, -lookbackDays)
  return points.filter((p) => p.date >= from && p.date <= date).at(-1)
}

const valueOn = (series: OverviewSeries, metric: string, date: string): number | undefined =>
  pointsOf(series, metric).find((p) => p.date === date)?.value

const zOf = (point: HealthDailyPoint | undefined): number | null =>
  point?.baseline && point.baseline.sd > 0 ? (point.value - point.baseline.mean) / point.baseline.sd : null

export const buildScoreSummary = (
  series: OverviewSeries,
  metric: ScoreMetric,
  date: string,
): HealthScoreSummary => {
  const point = latestPoint(pointsOf(series, metric), date)
  if (!point) {
    return {
      baseline: null,
      date: null,
      delta: null,
      details: [],
      metric,
      value: null,
      weakest_contributors: [],
    }
  }
  const valuesFor = (metrics: readonly string[]): HealthValue[] =>
    metrics.flatMap((m) => {
      const value = valueOn(series, m, point.date)
      return value === undefined ? [] : [{ metric: m, value }]
    })
  return {
    baseline: point.baseline,
    date: point.date,
    delta: point.baseline ? point.value - point.baseline.mean : null,
    details: valuesFor(scoreDetails[metric]),
    metric,
    value: point.value,
    weakest_contributors: valuesFor(scoreContributors[metric])
      .filter((c) => c.value < WEAK_CONTRIBUTOR_BELOW)
      .sort((a, b) => a.value - b.value)
      .slice(0, 2),
  }
}

const signalStatus = (point: HealthDailyPoint | undefined, z: number | null): HealthSignalStatus => {
  if (!point) return 'missing'
  if (!point.baseline) return 'insufficient_data'
  if (z === null || Math.abs(z) < SIGNAL_Z) return 'normal'
  return z > 0 ? 'above' : 'below'
}

const isFavorable = (metric: HealthMetric, status: HealthSignalStatus, z: number | null): boolean | null => {
  const direction = healthMetricCatalog[metric].direction
  if ((status !== 'above' && status !== 'below') || direction === 'neutral' || z === null) return null
  return direction === 'higher' ? z > 0 : z < 0
}

export const buildSignalSummary = (
  series: OverviewSeries,
  metric: HealthMetric,
  date: string,
): HealthSignalSummary => {
  const point = latestPoint(pointsOf(series, metric), date)
  const z = zOf(point)
  const status = signalStatus(point, z)
  return {
    baseline: point?.baseline ?? null,
    date: point?.date ?? null,
    delta: point?.baseline ? point.value - point.baseline.mean : null,
    favorable: isFavorable(metric, status, z),
    metric,
    status,
    value: point?.value ?? null,
    z,
  }
}

const decodeStressSummary = (value: number): StressDaySummary | null =>
  (({ 1: 'restored', 2: 'normal', 3: 'stressful' }) as const)[Math.round(value) as 1 | 2 | 3] ?? null

export const decodeResilience = (value: number | undefined): ResilienceLevel | null => {
  if (value === undefined) return null
  const index = Math.round(value / 20) - 1
  return resilienceLevels[Math.min(resilienceLevels.length - 1, Math.max(0, index))] ?? null
}

const STRESS_SUMMARY_LOOKBACK = 6
const RESILIENCE_LOOKBACK = 6
const RESILIENCE_PREVIOUS_DAYS = 14

const buildResilienceSummary = (series: OverviewSeries, date: string): HealthStressSummary['resilience'] => {
  const points = pointsOf(series, 'resilience_score')
  const latest = latestPoint(points, date, RESILIENCE_LOOKBACK)
  if (!latest) {
    return {
      contributors: { daytime_recovery: null, sleep_recovery: null, stress: null },
      date: null,
      level: null,
      previous_level: null,
    }
  }
  const previous = latestPoint(points, addDays(latest.date, -RESILIENCE_PREVIOUS_DAYS), LATEST_LOOKBACK_DAYS)
  const valueFor = (metric: string) => valueOn(series, metric, latest.date) ?? null
  return {
    contributors: {
      daytime_recovery: valueFor('resilience_daytime_recovery'),
      sleep_recovery: valueFor('resilience_sleep_recovery'),
      stress: valueFor('resilience_stress'),
    },
    date: latest.date,
    level: decodeResilience(latest.value),
    previous_level: decodeResilience(previous?.value),
  }
}

export const buildStressSummary = (
  series: OverviewSeries,
  date: string,
  today: string,
): HealthStressSummary => {
  const totalsDay = [
    latestPoint(pointsOf(series, 'stress_high_sec'), date)?.date,
    latestPoint(pointsOf(series, 'recovery_high_sec'), date)?.date,
  ]
    .filter((d): d is string => !!d)
    .sort()
    .at(-1)
  const summary = latestPoint(pointsOf(series, 'stress_day_summary'), date, STRESS_SUMMARY_LOOKBACK)
  const weekStart = addDays(date, -STRESS_SUMMARY_LOOKBACK)
  const stressfulDays = pointsOf(series, 'stress_day_summary').filter(
    (p) => p.date >= weekStart && p.date <= date && Math.round(p.value) === 3,
  ).length
  const totalOf = (metric: string) => (totalsDay ? (valueOn(series, metric, totalsDay) ?? null) : null)
  return {
    date: totalsDay ?? null,
    day_summary: summary ? decodeStressSummary(summary.value) : null,
    day_summary_date: summary?.date ?? null,
    is_partial_day: totalsDay !== undefined && totalsDay === today,
    recovery_high_sec: totalOf('recovery_high_sec'),
    resilience: buildResilienceSummary(series, date),
    stress_high_sec: totalOf('stress_high_sec'),
    stressful_days_last_7: stressfulDays,
  }
}

export interface AgeInputs {
  birthDate?: string | null
  ouraPersonalInfo?: { age: number; received_at: Date } | null
}

export const computeAge = (
  { birthDate, ouraPersonalInfo }: AgeInputs,
  date: string,
  tz: string,
): HealthAge | null => {
  if (birthDate && /^\d{4}-\d{2}-\d{2}$/.test(birthDate) && birthDate <= date) {
    return { as_of: date, source: 'birth_date', years: wholeYearsBetween(birthDate, date) }
  }
  if (ouraPersonalInfo) {
    const fetched = localDateOf(ouraPersonalInfo.received_at, tz)
    const elapsed = fetched <= date ? wholeYearsBetween(fetched, date) : 0
    return { as_of: date, source: 'oura_personal_info', years: Math.floor(ouraPersonalInfo.age) + elapsed }
  }
  return null
}

export interface OverviewInputs {
  date: string
  today: string
  tz: string
  series: OverviewSeries
  age: HealthAge | null
}

export const buildHealthOverview = ({ age, date, series, today, tz }: OverviewInputs): HealthOverviewData => {
  const scores = {
    activity: buildScoreSummary(series, 'activity_score', date),
    readiness: buildScoreSummary(series, 'readiness_score', date),
    sleep: buildScoreSummary(series, 'sleep_score', date),
  }
  const signals = signalMetrics.map((m) => buildSignalSummary(series, m, date))
  const stress = buildStressSummary(series, date, today)
  return {
    age,
    date,
    insights: buildHealthInsights({ date, readiness: scores.readiness, series, signals, stress }),
    last_sleep_date:
      pointsOf(series, 'sleep_duration_sec')
        .filter((p) => p.date <= date)
        .at(-1)?.date ?? null,
    scores,
    signals,
    stress,
    tz,
  }
}

export const getHealthOverview = async (
  user: string,
  { date, tz }: { date?: string; tz: string },
  now: Date = new Date(),
): Promise<HealthOverviewData> => {
  const today = todayIn(tz, now)
  const day = date ?? today
  const [series, settings, ouraPersonalInfo] = await Promise.all([
    fetchDailySeries(
      user,
      overviewMetrics,
      addDays(day, -OVERVIEW_HISTORY_DAYS),
      day,
      tz,
      OVERVIEW_BASELINE_DAYS,
    ),
    getSettings(user),
    getLatestOuraPersonalInfo(user),
  ])
  const age = computeAge({ birthDate: settings.birth_date, ouraPersonalInfo }, day, tz)
  return buildHealthOverview({ age, date: day, series, today, tz })
}
