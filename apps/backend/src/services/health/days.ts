import { isKnownTimezone } from '@aurboda/api-spec'
import { Temporal } from '@js-temporal/polyfill'

import { httpError } from '../../http-error.ts'
import { getSettings } from '../settings.ts'

export const addDays = (date: string, days: number): string =>
  Temporal.PlainDate.from(date).add({ days }).toString()

/** Whole days from `a` to `b` (positive when `b` is later). */
export const daysBetween = (a: string, b: string): number =>
  Temporal.PlainDate.from(a).until(Temporal.PlainDate.from(b), { largestUnit: 'days' }).days

/** The instant a local calendar day starts in `tz`. */
export const localDayStart = (date: string, tz: string): Date =>
  new Date(Temporal.PlainDate.from(date).toZonedDateTime(tz).epochMilliseconds)

const zoned = (instant: Date, tz: string) =>
  Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(tz)

export const localDateOf = (instant: Date, tz: string): string => zoned(instant, tz).toPlainDate().toString()

/** Minutes after local midnight, to the whole minute. */
export const localClockMinutes = (instant: Date, tz: string): number => {
  const z = zoned(instant, tz)
  return Math.round(z.hour * 60 + z.minute + z.second / 60)
}

export const localHour = (instant: Date, tz: string): number => zoned(instant, tz).hour

export const todayIn = (tz: string, now: Date = new Date()): string => localDateOf(now, tz)

/** Whole years from `from` to `to` (both YYYY-MM-DD). */
export const wholeYearsBetween = (from: string, to: string): number =>
  Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), { largestUnit: 'years' }).years

/** `tz` param → the user's `device_timezone` setting → UTC. */
export const resolveHealthTz = async (user: string, tz: string | undefined): Promise<string> => {
  const resolved = tz && tz.length > 0 ? tz : ((await getSettings(user)).device_timezone ?? 'UTC')
  if (!isKnownTimezone(resolved)) throw httpError(400, `Unknown timezone: ${resolved}`)
  return resolved
}

export const parseIntParam = (raw: string | number | undefined, fallback: number): number =>
  raw === undefined || raw === '' ? fallback : Number(raw)
