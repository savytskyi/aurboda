import {
  type TagImpactData,
  type TagImpactItem,
  type TagImpactOutcome,
  tagImpactOutcomeMetrics,
} from '@aurboda/api-spec'

import { getDailyMetricValues, getOuraTagOccurrences, type TagOccurrenceRow } from '../../db/index.ts'
import { httpError } from '../../http-error.ts'
import { twoGroupComparison } from '../correlations/stats.ts'
import { addDays, localDateOf, localDayStart, localHour, todayIn } from './days.ts'

export const TAG_IMPACT_MIN_SAMPLES = 5
export const DEFAULT_TAG_IMPACT_DAYS = 1095
/** Tags logged before this local hour belong to the previous evening. */
const LATE_NIGHT_HOUR = 5
/**
 * Untagged nights only count as the comparison group within this many days of
 * a tagged night, so a tag used for one week in 2023 is not compared with
 * nights years later, when HRV and resting HR had drifted for other reasons.
 */
export const TAG_IMPACT_CONTROL_WINDOW_DAYS = 30

type OutcomeMetric = (typeof tagImpactOutcomeMetrics)[number]

/** Oura tag keys whose words are run together. */
const OURA_TAG_WORDS: Record<string, string> = {
  latemeal: 'late meal',
  latework: 'late work',
  nocaffeine: 'no caffeine',
}

export const humanizeTag = (type: string): string => {
  const key = type.replace(/^tag_(generic|sleep)_/, '')
  const words = OURA_TAG_WORDS[key] ?? key.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const tagLabel = (row: Pick<TagOccurrenceRow, 'activity_type' | 'display_name'>): string =>
  row.display_name && row.display_name !== row.activity_type
    ? row.display_name
    : humanizeTag(row.activity_type)

export const exposureDay = (start: Date, tz: string): string => {
  const day = localDateOf(start, tz)
  return localHour(start, tz) < LATE_NIGHT_HOUR ? addDays(day, -1) : day
}

export interface TagImpactInputs {
  occurrences: TagOccurrenceRow[]
  /** Outcome value per wake day, for days in the window. */
  outcomes: Record<OutcomeMetric, ReadonlyMap<string, number>>
  tz: string
  minSamples?: number
}

/** Wake days within the control window of any night after a tagged day. */
export const controlWakeDays = (exposures: ReadonlySet<string>, windowDays: number): Set<string> => {
  const days = new Set<string>()
  for (const exposure of exposures) {
    const wakeDay = addDays(exposure, 1)
    for (let offset = -windowDays; offset <= windowDays; offset++) days.add(addDays(wakeDay, offset))
  }
  return days
}

const compareOutcome = (
  metric: OutcomeMetric,
  values: ReadonlyMap<string, number>,
  exposures: ReadonlySet<string>,
  controlDays: ReadonlySet<string>,
  minSamples: number,
): TagImpactOutcome => {
  const withValues: number[] = []
  const withoutValues: number[] = []
  for (const [wakeDay, value] of values) {
    if (exposures.has(addDays(wakeDay, -1))) withValues.push(value)
    else if (controlDays.has(wakeDay)) withoutValues.push(value)
  }
  const c = twoGroupComparison(withValues, withoutValues)
  return {
    cohens_d: c.cohens_d,
    difference: c.difference,
    enough_data: c.n_with >= minSamples && c.n_without >= minSamples,
    mean_with: c.mean_with,
    mean_without: c.mean_without,
    metric,
    n_with: c.n_with,
    n_without: c.n_without,
    p_value: c.welch?.p_value ?? null,
  }
}

/**
 * Per tag, the night after each tagged day against the untagged nights within
 * the control window around them. Nights without an outcome value drop out of
 * both groups.
 */
export const buildTagImpact = ({
  minSamples = TAG_IMPACT_MIN_SAMPLES,
  occurrences,
  outcomes,
  tz,
}: TagImpactInputs): TagImpactItem[] => {
  const byTag = new Map<string, { label: string; days: Set<string> }>()
  for (const o of occurrences) {
    const entry = byTag.get(o.activity_type) ?? { days: new Set<string>(), label: tagLabel(o) }
    entry.days.add(exposureDay(o.start_time, tz))
    byTag.set(o.activity_type, entry)
  }
  return [...byTag.entries()]
    .map(([tag, { days, label }]) => {
      const sorted = [...days].sort()
      const controlDays = controlWakeDays(days, TAG_IMPACT_CONTROL_WINDOW_DAYS)
      return {
        first_date: sorted[0]!,
        label,
        last_date: sorted.at(-1)!,
        outcomes: tagImpactOutcomeMetrics.map((m) =>
          compareOutcome(m, outcomes[m], days, controlDays, minSamples),
        ),
        tag,
        tagged_days: days.size,
      }
    })
    .sort((a, b) => b.tagged_days - a.tagged_days || a.label.localeCompare(b.label))
}

export const getTagImpact = async (
  user: string,
  { days = DEFAULT_TAG_IMPACT_DAYS, tz }: { days?: number; tz: string },
  now: Date = new Date(),
): Promise<TagImpactData> => {
  if (!Number.isInteger(days) || days < 30 || days > 3650) {
    throw httpError(400, 'days must be between 30 and 3650')
  }
  const end = todayIn(tz, now)
  const start = addDays(end, -days)
  const windowStart = localDayStart(start, tz)
  const windowEnd = localDayStart(addDays(end, 1), tz)
  const [occurrences, rows] = await Promise.all([
    getOuraTagOccurrences(user, windowStart, windowEnd),
    getDailyMetricValues(user, [...tagImpactOutcomeMetrics], windowStart, windowEnd, tz),
  ])
  const outcomes = Object.fromEntries(
    tagImpactOutcomeMetrics.map((m) => [
      m,
      new Map(
        rows.filter((r) => r.metric === m && r.date >= start && r.date <= end).map((r) => [r.date, r.value]),
      ),
    ]),
  ) as Record<OutcomeMetric, Map<string, number>>
  return {
    end,
    min_samples: TAG_IMPACT_MIN_SAMPLES,
    start,
    tags: buildTagImpact({ occurrences, outcomes, tz }),
    tz,
  }
}
