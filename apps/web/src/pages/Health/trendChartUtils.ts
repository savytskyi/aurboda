import type { HealthDailyPoint } from '@aurboda/api-spec'

import * as d3 from 'd3'

import { daySpanTickStep } from '../../components/charts/chart-ticks'
import { addDays, normalBounds } from './format'

export interface BandPoint {
  date: string
  hi: number
  lo: number
  mean: number
}

/**
 * Contiguous runs of consecutive days that carry a baseline. A missing day or a
 * day without a baseline ends the run, so the band breaks across gaps instead of
 * bridging them.
 */
export const bandSegments = (points: readonly HealthDailyPoint[], metric = ''): BandPoint[][] => {
  const segments: BandPoint[][] = []
  let current: BandPoint[] = []
  let previousDate: string | null = null
  for (const point of points) {
    const contiguous = previousDate !== null && addDays(previousDate, 1) === point.date
    if (!point.baseline || !contiguous) {
      if (current.length > 0) segments.push(current)
      current = []
    }
    if (point.baseline) {
      const { hi, lo } = normalBounds(metric, point.baseline)
      current.push({ date: point.date, hi, lo, mean: point.baseline.mean })
    }
    previousDate = point.date
  }
  if (current.length > 0) segments.push(current)
  return segments
}

/** Every local day from `start` to `end` inclusive. */
export const daysBetween = (start: string, end: string): string[] => {
  const days: string[] = []
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day)
  return days
}

/**
 * Value extent, widened by everything that must stay visible (the band, zero,
 * a reference line) and padded by 10 % of the span.
 */
export const paddedDomain = (values: readonly number[]): [number, number] | null => {
  const finite = values.filter(Number.isFinite)
  if (finite.length === 0) return null
  let lo = Math.min(...finite)
  let hi = Math.max(...finite)
  const pad = (hi - lo) * 0.1 || Math.max(Math.abs(hi) * 0.1, 1)
  const allNonNegative = lo >= 0
  lo -= pad
  hi += pad
  if (allNonNegative && lo < 0) lo = 0
  return [lo, hi]
}

export const nearestIndex = (dates: readonly number[], target: number): number => {
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  dates.forEach((d, i) => {
    const distance = Math.abs(d - target)
    if (distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  })
  return best
}

/** Keyboard navigation over chart positions; null when the key does not move. */
export const stepIndex = (key: string, current: number | null, last: number): number | null => {
  if (last < 0) return null
  const from = current ?? last
  const moves: Record<string, number> = {
    ArrowLeft: Math.max(0, from - 1),
    ArrowRight: Math.min(last, from + 1),
    End: last,
    Home: 0,
  }
  return moves[key] ?? null
}

/** Day ticks for short spans (distinct labels), else roughly one per 90px. */
export const timeTicks = (x: d3.ScaleTime<number, number>, spanDays: number, innerWidth: number): Date[] => {
  const step = daySpanTickStep(spanDays)
  const interval = step === null ? null : d3.timeDay.every(step)
  return interval ? x.ticks(interval) : x.ticks(Math.max(2, Math.floor(innerWidth / 90)))
}

export const timeTickFormat = (spanDays: number): ((d: Date) => string) =>
  spanDays > 200 ? d3.timeFormat("%b '%y") : d3.timeFormat('%b %d')

/**
 * Trailing mean over the calendar days `(date − windowDays, date]` for each
 * point, so a gap shortens the window rather than pulling in older values.
 */
export const rollingMean = (points: readonly HealthDailyPoint[], windowDays = 7): HealthDailyPoint[] => {
  let from = 0
  let total = 0
  return points.map((point, i) => {
    total += point.value
    const earliest = addDays(point.date, -(windowDays - 1))
    while (from < i && (points[from]?.date ?? '') < earliest) {
      total -= points[from]?.value ?? 0
      from += 1
    }
    return { ...point, value: total / (i - from + 1) }
  })
}
