import type {
  BedtimeRecommendation,
  OptimalBedtime,
  SleepScheduleData,
  SleepScheduleNight,
} from '@aurboda/api-spec'

import { clockLabel, shortDate } from '../Health/format'

const DAY_MIN = 1440

/** Wake time on the bedtime clock scale: the morning after, so past 1440. */
export const wakeOnBedtimeScale = (wakeClockMin: number): number => wakeClockMin + DAY_MIN

/**
 * Y domain of the schedule chart in clock minutes, evening first: from the
 * earliest bedtime (or optimal window start) to the latest wake, rounded out to
 * whole hours. Null without nights.
 */
export const clockDomain = (
  nights: readonly Pick<SleepScheduleNight, 'bedtime_clock_min' | 'wake_clock_min'>[],
  optimal?: Pick<OptimalBedtime, 'end_clock_min' | 'start_clock_min'> | null,
): [number, number] | null => {
  if (nights.length === 0) return null
  const tops = nights.map((n) => n.bedtime_clock_min)
  const bottoms = nights.map((n) => wakeOnBedtimeScale(n.wake_clock_min))
  if (optimal) {
    tops.push(optimal.start_clock_min)
    bottoms.push(optimal.end_clock_min)
  }
  const lo = Math.floor(Math.min(...tops) / 60) * 60
  const hi = Math.ceil(Math.max(...bottoms) / 60) * 60
  return [lo, hi === lo ? lo + 60 : hi]
}

/** Tick positions on whole hours, every `step` hours. */
export const clockTicks = ([lo, hi]: [number, number]): number[] => {
  const hours = (hi - lo) / 60
  const step = hours > 12 ? 3 : hours > 6 ? 2 : 1
  const ticks: number[] = []
  for (let t = Math.ceil(lo / (60 * step)) * 60 * step; t <= hi; t += 60 * step) ticks.push(t)
  return ticks
}

export const scheduleStatsText = (stats: SleepScheduleData['stats']): string | null => {
  const parts: string[] = []
  if (stats.bedtime_mean_clock_min !== null) {
    const sd = stats.bedtime_sd_min === null ? '' : ` ± ${Math.round(stats.bedtime_sd_min)} min`
    parts.push(`Bedtime ${clockLabel(stats.bedtime_mean_clock_min)}${sd}`)
  }
  if (stats.wake_mean_clock_min !== null) {
    const sd = stats.wake_sd_min === null ? '' : ` ± ${Math.round(stats.wake_sd_min)} min`
    parts.push(`Wake ${clockLabel(stats.wake_mean_clock_min)}${sd}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

export const humanise = (code: string): string => {
  const words = code.replaceAll(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const windowText = (w: OptimalBedtime): string =>
  `${clockLabel(w.start_clock_min)}–${clockLabel(w.end_clock_min)}`

const RECOMMENDATIONS: Record<string, string> = {
  earlier_bedtime: 'Oura suggests going to bed earlier',
  improve_efficiency: 'Oura suggests improving your sleep efficiency before changing your bedtime',
  later_bedtime: 'Oura suggests going to bed later',
  later_wake_up_time: 'Oura suggests waking up later',
}

const STATUSES: Record<string, string> = {
  not_enough_nights: 'Oura needs more nights to recommend a bedtime',
}

/**
 * Friendly sentences for Oura's bedtime recommendation. A window from an
 * earlier day (`last_optimal`) says when it was found.
 */
export const recommendationLines = (rec: BedtimeRecommendation | null): string[] => {
  if (!rec) return []
  const lines: string[] = []
  const status = STATUSES[rec.status]
  if (status) lines.push(status)

  const window = rec.optimal ?? rec.last_optimal
  const windowSuffix =
    !rec.optimal && rec.last_optimal ? ` (last found on ${shortDate(rec.last_optimal.date)})` : ''

  if (rec.recommendation === 'follow_optimal_bedtime') {
    lines.push(
      window
        ? `Oura found an optimal bedtime window: ${windowText(window)}${windowSuffix}`
        : 'Oura suggests following your optimal bedtime',
    )
    return lines
  }
  if (rec.recommendation) lines.push(RECOMMENDATIONS[rec.recommendation] ?? humanise(rec.recommendation))
  if (window) lines.push(`Optimal bedtime window: ${windowText(window)}${windowSuffix}`)
  return lines
}
