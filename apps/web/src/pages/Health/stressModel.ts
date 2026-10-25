import type { HealthDailyPoint, ResilienceLevel, StressDaySummary } from '@aurboda/api-spec'

import { resilienceLevels } from '@aurboda/api-spec'

import type { StatusChipProps } from './StatusChip'

import { weeklySums } from './dailyBarUtils'
import { capitalise } from './overviewModel'

const SUMMARY_BY_VALUE: Record<number, StressDaySummary> = { 1: 'restored', 2: 'normal', 3: 'stressful' }

/** `stress_day_summary` is stored as 1 restored, 2 normal, 3 stressful. */
export const daySummaryOf = (value: number): StressDaySummary | null =>
  SUMMARY_BY_VALUE[Math.round(value)] ?? null

export const daySummaryCounts = (points: readonly HealthDailyPoint[]): Record<StressDaySummary, number> => {
  const counts: Record<StressDaySummary, number> = { normal: 0, restored: 0, stressful: 0 }
  for (const p of points) {
    const summary = daySummaryOf(p.value)
    if (summary) counts[summary] += 1
  }
  return counts
}

/** `resilience_score` is stored as 20 limited … 100 exceptional. */
export const resilienceLevelOf = (value: number): ResilienceLevel | null => {
  const index = Math.round(value / 20) - 1
  return resilienceLevels[index] ?? null
}

export const resilienceLevelLabel = (level: ResilienceLevel): string => capitalise(level)

export const resilienceChip = (level: ResilienceLevel): StatusChipProps => {
  const label = resilienceLevelLabel(level)
  if (level === 'limited') return { label, tone: 'watch' }
  if (level === 'adequate') return { label, tone: 'info' }
  return { label, tone: 'good' }
}

export type BalanceView = 'daily' | 'weekly'

/** Daily values as-is, or summed into ISO weeks keyed by their Monday. */
export const balanceValues = (
  points: readonly HealthDailyPoint[],
  view: BalanceView,
): Map<string, number> => {
  const daily = new Map(points.map((p) => [p.date, p.value]))
  return view === 'weekly' ? weeklySums(daily) : daily
}
