import type {
  BedtimeRecommendation,
  OptimalBedtime,
  SleepScheduleData,
  SleepScheduleNight,
} from '@aurboda/api-spec'

import {
  getSleepSessionsEndingBetween,
  getSleepTimeRecords,
  type SleepSessionRow,
  type SleepTimeRecord,
} from '../../db/index.ts'
import { httpError } from '../../http-error.ts'
import { mean, stddev } from '../correlations/stats.ts'
import { addDays, daysBetween, localClockMinutes, localDateOf, localDayStart } from './days.ts'

export const MAX_SCHEDULE_RANGE_DAYS = 400

const NOON_MIN = 720
const DAY_MIN = 1440

/** Minutes after local midnight; a bedtime before noon belongs to the previous evening's scale (+1440). */
export const bedtimeClockMinutes = (bedtime: Date, tz: string): number => {
  const minutes = localClockMinutes(bedtime, tz)
  return minutes < NOON_MIN ? minutes + DAY_MIN : minutes
}

const isOuraMain = (s: SleepSessionRow) => s.source === 'oura' && s.oura_type === 'long_sleep'
const durationMs = (s: SleepSessionRow) => s.end_time.getTime() - s.start_time.getTime()

/** One main sleep per local wake day: Oura's `long_sleep`, else the longest sleep that day. */
export const pickMainSleeps = (sessions: SleepSessionRow[], tz: string): SleepScheduleNight[] => {
  const byDay = new Map<string, SleepSessionRow>()
  for (const s of sessions) {
    const day = localDateOf(s.end_time, tz)
    const current = byDay.get(day)
    const better =
      !current ||
      (isOuraMain(s) && !isOuraMain(current)) ||
      (isOuraMain(s) === isOuraMain(current) && durationMs(s) > durationMs(current))
    if (better) byDay.set(day, s)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, s]) => ({
      bedtime_clock_min: bedtimeClockMinutes(s.start_time, tz),
      bedtime_end: s.end_time.toISOString(),
      bedtime_start: s.start_time.toISOString(),
      date,
      wake_clock_min: localClockMinutes(s.end_time, tz),
    }))
}

const round1 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10)

export const scheduleStats = (nights: SleepScheduleNight[]): SleepScheduleData['stats'] => {
  const bed = nights.map((n) => n.bedtime_clock_min)
  const wake = nights.map((n) => n.wake_clock_min)
  return {
    bedtime_mean_clock_min: round1(mean(bed)),
    bedtime_sd_min: round1(stddev(bed)),
    n: nights.length,
    wake_mean_clock_min: round1(mean(wake)),
    wake_sd_min: round1(stddev(wake)),
  }
}

export const optimalFrom = (record: SleepTimeRecord | null): OptimalBedtime | null => {
  const window = record?.optimal_bedtime
  if (
    !record ||
    !window ||
    typeof window.start_offset !== 'number' ||
    typeof window.end_offset !== 'number'
  ) {
    return null
  }
  return {
    date: record.day,
    end_clock_min: DAY_MIN + window.end_offset / 60,
    start_clock_min: DAY_MIN + window.start_offset / 60,
  }
}

export const buildRecommendation = (
  latest: SleepTimeRecord | null,
  latestWithOptimal: SleepTimeRecord | null,
): BedtimeRecommendation | null => {
  if (!latest) return null
  const optimal = optimalFrom(latest)
  return {
    date: latest.day,
    last_optimal: optimal ? null : optimalFrom(latestWithOptimal),
    optimal,
    recommendation: latest.recommendation ?? null,
    status: latest.status ?? 'unknown',
  }
}

export const getSleepSchedule = async (
  user: string,
  { end, start, tz }: { start: string; end: string; tz: string },
): Promise<SleepScheduleData> => {
  if (start > end) throw httpError(400, 'start must be on or before end')
  if (daysBetween(start, end) > MAX_SCHEDULE_RANGE_DAYS) {
    throw httpError(400, `Range is limited to ${MAX_SCHEDULE_RANGE_DAYS} days`)
  }
  const [sessions, records] = await Promise.all([
    getSleepSessionsEndingBetween(user, localDayStart(start, tz), localDayStart(addDays(end, 1), tz)),
    getSleepTimeRecords(user, end),
  ])
  const nights = pickMainSleeps(sessions, tz)
  return {
    nights,
    recommendation: buildRecommendation(records.latest, records.latest_with_optimal),
    stats: scheduleStats(nights),
    tz,
  }
}
