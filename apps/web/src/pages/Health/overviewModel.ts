import type {
  HealthBaseline,
  HealthInsightSeverity,
  HealthScoreSummary,
  HealthSignalSummary,
  HealthStressSummary,
  ResilienceLevel,
  StressDaySummary,
} from '@aurboda/api-spec'

import { resilienceLevels } from '@aurboda/api-spec'

import type { StatusChipProps, StatusTone } from './StatusChip'

import {
  formatDuration,
  formatMetricRange,
  formatMetricValue,
  metricLabel,
  normalBounds,
  shortDate,
} from './format'

export const WEARABLE_NOTE =
  'Estimates from a consumer wearable, compared with your own recent normal — not medical advice.'

export type ScoreKind = 'readiness' | 'sleep' | 'activity'

const detail = (summary: HealthScoreSummary, metric: string): number | null =>
  summary.details.find((d) => d.metric === metric)?.value ?? null

/** Walking-equivalent distance as a whole percentage of the daily target. */
export const targetProgress = (summary: HealthScoreSummary): number | null => {
  const distance = detail(summary, 'equivalent_walking_distance')
  const target = detail(summary, 'activity_target_meters')
  if (distance === null || target === null || target <= 0) return null
  return Math.round((distance / target) * 100)
}

export const scoreContext = (kind: ScoreKind, summary: HealthScoreSummary): string | null => {
  if (summary.value === null) return null
  if (kind === 'readiness') {
    const weakest = summary.weakest_contributors[0]
    return weakest
      ? `Lowest: ${metricLabel(weakest.metric)} ${formatMetricValue(weakest.metric, weakest.value)}`
      : 'All contributors in good shape'
  }
  if (kind === 'sleep') {
    const duration = detail(summary, 'sleep_duration_sec')
    const efficiency = detail(summary, 'sleep_efficiency_percent')
    const parts = [
      duration === null ? null : `${formatDuration(duration)} asleep`,
      efficiency === null ? null : `${formatMetricValue('sleep_efficiency_percent', efficiency)} efficiency`,
    ].filter((p) => p !== null)
    return parts.length > 0 ? parts.join(' · ') : null
  }
  const steps = detail(summary, 'steps')
  const progress = targetProgress(summary)
  const parts = [
    steps === null ? null : `${formatMetricValue('steps', steps)} steps`,
    progress === null ? null : `${progress}% of daily target`,
  ].filter((p) => p !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** "from Oct 22" when the value is not for the overview's day. */
export const valueDateNote = (valueDate: string | null, overviewDate: string): string | null =>
  valueDate && valueDate !== overviewDate ? `from ${shortDate(valueDate)}` : null

export const lastNightCaption = (lastSleepDate: string | null, overviewDate: string): string => {
  if (lastSleepDate === null) return 'No sleep recorded for last night'
  if (lastSleepDate === overviewDate) return `Last night: woke ${shortDate(lastSleepDate)}`
  return `No sleep recorded for last night (latest: ${shortDate(lastSleepDate)})`
}

export const normalRangeText = (metric: string, baseline: HealthBaseline | null): string | null => {
  if (!baseline) return null
  const { hi, lo } = normalBounds(metric, baseline)
  return `normal ${formatMetricRange(metric, lo, hi)}`
}

export const signalChip = (signal: HealthSignalSummary): StatusChipProps => {
  switch (signal.status) {
    case 'normal':
      return { label: 'Normal', tone: 'good' }
    case 'above':
      return { icon: '▲', label: 'Above normal', tone: signal.favorable === true ? 'good' : 'watch' }
    case 'below':
      return { icon: '▼', label: 'Below normal', tone: signal.favorable === true ? 'good' : 'watch' }
    case 'insufficient_data':
      return { label: 'Building baseline', tone: 'info' }
    default:
      return { label: 'No data', tone: 'info' }
  }
}

export interface StressSplit {
  restorativePercent: number
  restorativeSec: number
  stressPercent: number
  stressSec: number
}

export const stressSplit = (stress: Pick<HealthStressSummary, 'recovery_high_sec' | 'stress_high_sec'>) => {
  const stressSec = stress.stress_high_sec ?? 0
  const restorativeSec = stress.recovery_high_sec ?? 0
  const total = stressSec + restorativeSec
  if (total <= 0) return null
  const stressPercent = Math.round((stressSec / total) * 100)
  return {
    restorativePercent: 100 - stressPercent,
    restorativeSec,
    stressPercent,
    stressSec,
  } satisfies StressSplit
}

export const DAY_SUMMARY: Record<StressDaySummary, { label: string; tone: StatusTone }> = {
  normal: { label: 'Normal', tone: 'good' },
  restored: { label: 'Restored', tone: 'positive' },
  stressful: { label: 'Stressful', tone: 'watch' },
}

export const daySummaryChip = (stress: HealthStressSummary, overviewDate: string): StatusChipProps | null => {
  if (!stress.day_summary) return null
  const { label, tone } = DAY_SUMMARY[stress.day_summary]
  const date = stress.day_summary_date
  return { label: date && date !== overviewDate ? `${label} (${shortDate(date)})` : label, tone }
}

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "Solid · steady for 2 weeks", "Solid · ↑ from Adequate 2 weeks ago". */
export const resilienceText = (
  level: ResilienceLevel | null,
  previous: ResilienceLevel | null,
): string | null => {
  if (!level) return null
  const name = capitalise(level)
  if (!previous) return name
  const diff = resilienceLevels.indexOf(level) - resilienceLevels.indexOf(previous)
  if (diff === 0) return `${name} · steady for 2 weeks`
  return `${name} · ${diff > 0 ? '↑' : '↓'} from ${capitalise(previous)} 2 weeks ago`
}

export const INSIGHT_SEVERITY: Record<HealthInsightSeverity, { label: string; tone: StatusTone }> = {
  alert: { label: 'Alert', tone: 'alert' },
  info: { label: 'Info', tone: 'info' },
  positive: { label: 'Good', tone: 'positive' },
  watch: { label: 'Watch', tone: 'watch' },
}
