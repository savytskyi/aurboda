import { useLocation } from 'preact-iso'

import { addDays, dayString } from './format'

export const DEFAULT_RANGE_DAYS = 30

export const parseRange = (
  raw: string | undefined,
  allowed: readonly number[],
  defaultDays: number = DEFAULT_RANGE_DAYS,
): number => {
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  if (allowed.includes(parsed)) return parsed
  return allowed.includes(defaultDays) ? defaultDays : (allowed[0] ?? defaultDays)
}

/** Inclusive `[start, end]` local days ending today. */
export const rangeDates = (days: number, today: Date = new Date()): { end: string; start: string } => {
  const end = dayString(today)
  return { end, start: addDays(end, -(days - 1)) }
}

export const rangeUrl = (path: string, query: Record<string, string>, days: number): string => {
  const params = new URLSearchParams(query)
  params.set('range', String(days))
  return `${path}?${params.toString()}`
}

export const useRange = (allowed: readonly number[], defaultDays?: number) => {
  const { path, query, route } = useLocation()
  const days = parseRange(query.range, allowed, defaultDays)
  const { end, start } = rangeDates(days)
  const setDays = (next: number) => route(rangeUrl(path, query, next), true)
  return { days, end, setDays, start }
}
