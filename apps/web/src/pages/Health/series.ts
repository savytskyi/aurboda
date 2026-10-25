import type { HealthDailyPoint } from '@aurboda/api-spec'

export const latestPoint = (points: readonly HealthDailyPoint[] | undefined): HealthDailyPoint | null =>
  points?.at(-1) ?? null

/** Latest value minus its personal-normal mean, or null without a baseline. */
export const latestDelta = (points: readonly HealthDailyPoint[] | undefined): number | null => {
  const latest = latestPoint(points)
  return latest?.baseline ? latest.value - latest.baseline.mean : null
}

export const rangeAverage = (points: readonly HealthDailyPoint[] | undefined): number | null =>
  points && points.length > 0 ? points.reduce((sum, p) => sum + p.value, 0) / points.length : null

export const valueOn = (
  points: readonly HealthDailyPoint[] | undefined,
  date: string | null,
): number | null => (date === null ? null : (points?.find((p) => p.date === date)?.value ?? null))

/** The most recent day any of the series has a value. */
export const latestDate = (seriesList: readonly (readonly HealthDailyPoint[] | undefined)[]): string | null =>
  seriesList.reduce<string | null>((max, points) => {
    const date = latestPoint(points)?.date ?? null
    return date !== null && (max === null || date > max) ? date : max
  }, null)

/**
 * Separate today's still-accumulating value (steps, calories, stress minutes)
 * from the complete days, so a half-finished day is neither charted against
 * full days nor compared with the normal.
 */
export const splitToday = (
  points: readonly HealthDailyPoint[],
  today: string,
  accumulating: boolean,
): { complete: HealthDailyPoint[]; today: HealthDailyPoint | null } => {
  if (!accumulating) return { complete: [...points], today: null }
  return {
    complete: points.filter((p) => p.date < today),
    today: points.find((p) => p.date === today) ?? null,
  }
}
