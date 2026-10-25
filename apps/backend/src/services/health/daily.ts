import {
  type HealthBaseline,
  type HealthDailyData,
  type HealthDailyPoint,
  healthMetricCatalog,
  isHealthMetric,
} from '@aurboda/api-spec'

import { getDailyMetricValues, type HealthDayValue } from '../../db/index.ts'
import { httpError } from '../../http-error.ts'
import { mean, stddev } from '../correlations/stats.ts'
import { addDays, daysBetween, localDayStart } from './days.ts'

export const MAX_DAILY_RANGE_DAYS = 3660
export const DEFAULT_BASELINE_DAYS = 30

export const minBaselineDays = (baselineDays: number): number => Math.max(7, Math.round(baselineDays / 2))

export interface DayValue {
  date: string
  value: number
}

const epochDay = (date: string): number => Date.parse(`${date}T00:00:00Z`) / 86_400_000

/**
 * Each day on or after `startDate` with its personal normal: mean and sample
 * SD of the values in `[date − baselineDays, date − 1]`, null with fewer than
 * `minN` of them. `points` must be ascending by date.
 */
export const withBaselines = (
  points: DayValue[],
  startDate: string,
  baselineDays: number,
  minN: number,
): HealthDailyPoint[] => {
  const days = points.map((p) => epochDay(p.date))
  const out: HealthDailyPoint[] = []
  for (const [i, p] of points.entries()) {
    if (p.date < startDate) continue
    const window: number[] = []
    for (let j = i - 1; j >= 0 && days[j]! >= days[i]! - baselineDays; j--) {
      if (days[j]! < days[i]!) window.push(points[j]!.value)
    }
    const baseline: HealthBaseline | null =
      window.length >= minN && window.length > 0
        ? { mean: mean(window)!, n: window.length, sd: stddev(window) ?? 0 }
        : null
    out.push({ baseline, date: p.date, value: p.value })
  }
  return out
}

export const groupByMetric = (rows: HealthDayValue[]): Map<string, DayValue[]> => {
  const byMetric = new Map<string, DayValue[]>()
  for (const r of rows) {
    const list = byMetric.get(r.metric) ?? []
    list.push({ date: r.date, value: r.value })
    byMetric.set(r.metric, list)
  }
  for (const list of byMetric.values()) list.sort((a, b) => a.date.localeCompare(b.date))
  return byMetric
}

/** Per-metric days in `[start, end]` with baselines, from one query. */
export const fetchDailySeries = async (
  user: string,
  metrics: readonly string[],
  start: string,
  end: string,
  tz: string,
  baselineDays: number,
): Promise<Map<string, HealthDailyPoint[]>> => {
  const rows = await getDailyMetricValues(
    user,
    [...metrics],
    localDayStart(addDays(start, -baselineDays), tz),
    localDayStart(addDays(end, 1), tz),
    tz,
  )
  const minN = minBaselineDays(baselineDays)
  const grouped = groupByMetric(rows)
  return new Map(metrics.map((m) => [m, withBaselines(grouped.get(m) ?? [], start, baselineDays, minN)]))
}

export interface HealthDailyOptions {
  metrics: string[]
  start: string
  end: string
  tz: string
  baselineDays?: number
}

export const validateDailyOptions = ({ baselineDays, end, metrics, start }: HealthDailyOptions): void => {
  const unknown = metrics.filter((m) => !isHealthMetric(m))
  if (metrics.length === 0) throw httpError(400, 'At least one metric is required')
  if (unknown.length > 0) throw httpError(400, `Unknown health metrics: ${unknown.join(', ')}`)
  if (start > end) throw httpError(400, 'start must be on or before end')
  if (daysBetween(start, end) > MAX_DAILY_RANGE_DAYS) {
    throw httpError(400, `Range is limited to ${MAX_DAILY_RANGE_DAYS} days`)
  }
  const b = baselineDays ?? DEFAULT_BASELINE_DAYS
  if (!Number.isInteger(b) || b < 7 || b > 180) {
    throw httpError(400, 'baseline_days must be between 7 and 180')
  }
}

export const getHealthDaily = async (user: string, options: HealthDailyOptions): Promise<HealthDailyData> => {
  validateDailyOptions(options)
  const { end, metrics, start, tz } = options
  const baselineDays = options.baselineDays ?? DEFAULT_BASELINE_DAYS
  const series = await fetchDailySeries(user, metrics, start, end, tz, baselineDays)
  return {
    baseline_days: baselineDays,
    end,
    min_baseline_days: minBaselineDays(baselineDays),
    series: metrics.map((metric) => ({
      metric,
      points: (series.get(metric) ?? []).filter((p) => p.date <= end),
      unit: isHealthMetric(metric) ? healthMetricCatalog[metric].unit : '',
    })),
    start,
    tz,
  }
}
