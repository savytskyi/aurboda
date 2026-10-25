import {
  type HealthBaseline,
  healthMetricCatalog,
  isHealthMetric,
  type HealthMetricInfo,
} from '@aurboda/api-spec'

export type DeltaTone = 'good' | 'bad' | 'neutral'

const LOCALE = 'en-US'

export const metricInfo = (metric: string): HealthMetricInfo | undefined =>
  isHealthMetric(metric) ? healthMetricCatalog[metric] : undefined

export const metricLabel = (metric: string): string => metricInfo(metric)?.label ?? metric

export const metricUnit = (metric: string): string => metricInfo(metric)?.unit ?? ''

const fixed = (value: number, maxDigits: number, minDigits = 0): string =>
  value.toLocaleString(LOCALE, { maximumFractionDigits: maxDigits, minimumFractionDigits: minDigits })

/** `7h 32m` from one hour up, `14 min` below. */
export const formatDuration = (sec: number): string => {
  const totalMin = Math.round(Math.abs(sec) / 60)
  if (totalMin < 60) return `${totalMin} min`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Display resolution: a value or delta smaller than half of it rounds to zero on screen. */
const resolution = (metric: string): number => {
  const unit = metricUnit(metric)
  switch (unit) {
    case 'sec':
      return 60
    case 'celsius':
    case 'brpm':
    case 'bpm':
    case 'index':
    case 'm/s':
    case 'mL/kg/min':
      return 0.1
    case 'percent':
    case '%':
      return metric === 'spo2' ? 0.1 : 1
    default:
      return 1
  }
}

const percent = (value: number, metric: string) => `${fixed(value, metric === 'spo2' ? 1 : 0)}%`
const integer = (value: number) => fixed(value, 0)

const UNIT_FORMATTERS: Record<string, (value: number, metric: string) => string> = {
  '%': percent,
  bpm: (v) => `${fixed(v, 1)} bpm`,
  brpm: (v) => `${fixed(v, 1, 1)} /min`,
  celsius: (v) => `${fixed(v, 1, 1)} °C`,
  count: integer,
  index: (v) => fixed(v, 1),
  kcal: (v) => `${integer(v)} kcal`,
  level: integer,
  m: (v) => (v >= 1000 ? `${fixed(v / 1000, 1, 1)} km` : `${integer(v)} m`),
  'm/s': (v) => `${fixed(v, 1)} m/s`,
  'mL/kg/min': (v) => `${fixed(v, 1)} mL/kg/min`,
  ms: (v) => `${integer(v)} ms`,
  percent,
  score: integer,
  sec: formatDuration,
  years: (v) => `${integer(v)} years`,
}

const formatMagnitude = (metric: string, value: number): string =>
  (UNIT_FORMATTERS[metricUnit(metric)] ?? ((v: number) => fixed(v, 1)))(value, metric)

const signed = (value: number, text: string): string => (value < 0 ? `−${text}` : `+${text}`)

export const formatMetricValue = (metric: string, value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (metricUnit(metric) === 'celsius') return signed(value, formatMagnitude(metric, Math.abs(value)))
  if (value < 0) return `−${formatMagnitude(metric, -value)}`
  return formatMagnitude(metric, value)
}

/** `26–33 ms`: the unit once, after the upper bound. */
export const formatMetricRange = (metric: string, lo: number, hi: number): string => {
  const unit = metricUnit(metric)
  if (unit === 'sec') return `${formatDuration(lo)}–${formatDuration(hi)}`
  const hiText = formatMetricValue(metric, hi)
  const loText = formatMetricValue(metric, lo)
  const loNumber = loText.match(/^[+−]?[\d.,]+/)?.[0] ?? loText
  return `${loNumber}–${hiText}`
}

export const isNegligibleDelta = (metric: string, delta: number): boolean =>
  Math.abs(delta) < resolution(metric) / 2

/** `↑ 3 ms`, `↓ 12 min`, `No change` when it would round to zero. */
export const formatDelta = (metric: string, delta: number | null | undefined): string => {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return '—'
  if (isNegligibleDelta(metric, delta)) return 'No change'
  const arrow = delta > 0 ? '↑' : '↓'
  return `${arrow} ${formatMagnitude(metric, Math.abs(delta))}`
}

export const deltaTone = (metric: string, delta: number | null | undefined): DeltaTone => {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return 'neutral'
  const direction = metricInfo(metric)?.direction ?? 'neutral'
  if (direction === 'neutral' || isNegligibleDelta(metric, delta)) return 'neutral'
  const up = delta > 0
  return up === (direction === 'higher') ? 'good' : 'bad'
}

/** Minutes on the clock scale (may exceed 1440 or be negative) → `22:30`. */
export const clockLabel = (clockMin: number): string => {
  const m = ((Math.round(clockMin) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Compact y-axis tick: durations in hours, everything else as a bare number. */
export const axisTickLabel = (metric: string, value: number): string => {
  const unit = metricUnit(metric)
  if (unit === 'sec') return `${fixed(value / 3600, 1)}h`
  if (unit === 'm' && value >= 1000) return `${fixed(value / 1000, 1)}k`
  if (Math.abs(value) >= 1000) return `${fixed(value / 1000, 1)}K`
  return fixed(value, 1)
}

export const parseDay = (day: string): Date => {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const dayString = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export const addDays = (day: string, n: number): string => {
  const d = parseDay(day)
  d.setDate(d.getDate() + n)
  return dayString(d)
}

/** `Oct 22` */
export const shortDate = (day: string): string =>
  parseDay(day).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })

/** `Saturday, October 24` */
export const longDate = (day: string): string =>
  parseDay(day).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', weekday: 'long' })

/** `Jan 3, 2025` */
export const dateWithYear = (day: string): string =>
  parseDay(day).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })

/** Metrics whose values can legitimately be negative; every other band stops at 0. */
const SIGNED_METRICS = new Set(['temperature_deviation', 'temperature_trend_deviation', 'meters_to_target'])

/** The personal-normal band, mean ± 1 sd, never below 0 for a quantity that can't be. */
export const normalBounds = (metric: string, baseline: HealthBaseline): { hi: number; lo: number } => {
  const lo = baseline.mean - baseline.sd
  return { hi: baseline.mean + baseline.sd, lo: SIGNED_METRICS.has(metric) ? lo : Math.max(0, lo) }
}

/**
 * `deltaTone`, but neutral while the difference is within half a standard
 * deviation of the personal normal: a 2-point dip in a score that normally
 * swings ±6 is not worth colouring red.
 */
export const baselineDeltaTone = (
  metric: string,
  delta: number | null | undefined,
  baseline: HealthBaseline | null | undefined,
): DeltaTone => {
  if (delta === null || delta === undefined) return 'neutral'
  if (baseline && Math.abs(delta) < baseline.sd / 2) return 'neutral'
  return deltaTone(metric, delta)
}
