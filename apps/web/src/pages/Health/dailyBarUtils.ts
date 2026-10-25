import { addDays, parseDay } from './format'

export interface BarSeriesValues {
  key: string
  /** Value per bucket date; a missing date is no bar. */
  values: ReadonlyMap<string, number>
  /** `down` series stack below the zero line (diverging bars). */
  direction?: 'up' | 'down'
}

export interface StackSegment {
  key: string
  value: number
  /** Signed data-space bounds: y0 is nearer zero. */
  y0: number
  y1: number
  /** The segment farthest from zero on its side, which gets the rounded data end. */
  outer: boolean
}

export interface StackedBar {
  date: string
  segments: StackSegment[]
}

/**
 * Stacks each date's values in series order: `up` series upward from zero,
 * `down` series downward from zero. Missing, zero and negative values add no
 * segment, so a stack never contains an empty sliver.
 */
export const stackBars = (
  dates: readonly string[],
  series: readonly BarSeriesValues[],
): { bars: StackedBar[]; max: number; min: number } => {
  let max = 0
  let min = 0
  const bars = dates.map((date) => {
    let up = 0
    let down = 0
    const segments: StackSegment[] = []
    for (const s of series) {
      const value = s.values.get(date)
      if (value === undefined || !Number.isFinite(value) || value <= 0) continue
      if (s.direction === 'down') {
        segments.push({ key: s.key, outer: false, value, y0: 0 - down, y1: -(down + value) })
        down += value
      } else {
        segments.push({ key: s.key, outer: false, value, y0: up, y1: up + value })
        up += value
      }
    }
    const lastUp = segments.findLast((seg) => seg.y1 > 0)
    const lastDown = segments.findLast((seg) => seg.y1 < 0)
    if (lastUp) lastUp.outer = true
    if (lastDown) lastDown.outer = true
    max = Math.max(max, up)
    min = Math.min(min, 0 - down)
    return { date, segments }
  })
  return { bars, max, min }
}

/** Monday of the ISO week that contains `day`. */
export const isoWeekStart = (day: string): string => {
  const weekday = (parseDay(day).getDay() + 6) % 7
  return addDays(day, -weekday)
}

/** Sums daily values into ISO weeks (keyed by their Monday), in date order. */
export const weeklySums = (values: ReadonlyMap<string, number>): Map<string, number> => {
  const sums = new Map<string, number>()
  for (const [day, value] of [...values.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const week = isoWeekStart(day)
    sums.set(week, (sums.get(week) ?? 0) + value)
  }
  return sums
}

/** Distinct ISO-week Mondays covering `[start, end]`. */
export const weeksCovering = (start: string, end: string): string[] => {
  const weeks: string[] = []
  for (let week = isoWeekStart(start); week <= end; week = addDays(week, 7)) weeks.push(week)
  return weeks
}

/** Indices of the labels to draw, at least `minGap` px apart, always including the last. */
export const labelIndices = (count: number, step: number, minGap = 56): number[] => {
  if (count === 0) return []
  const every = Math.max(1, Math.ceil(minGap / Math.max(step, 1)))
  const picked: number[] = []
  for (let i = count - 1; i >= 0; i -= every) picked.unshift(i)
  return picked
}

const UNIT_STEPS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 24]

/**
 * Round-number ticks for a duration axis: steps are whole multiples (or
 * quarters/halves) of `unit`, e.g. hours for values stored in seconds, so the
 * axis reads 0h / 2h / 4h rather than 0h / 2.8h / 5.6h.
 */
export const unitTicks = (min: number, max: number, unit: number, target = 4): number[] => {
  const span = Math.max(max - min, unit / 4) / unit
  const step = (UNIT_STEPS.find((s) => span / s <= target) ?? Math.ceil(span / target)) * unit
  const first = Math.floor(min / step) * step
  const last = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let t = first; t <= last + step / 1e6; t += step) ticks.push(Math.round(t * 1e6) / 1e6)
  return ticks
}
