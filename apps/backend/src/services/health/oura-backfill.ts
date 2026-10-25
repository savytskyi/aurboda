import { activityContributorMetrics, type OuraMetricBackfillData } from '@aurboda/api-spec'

import type { TimeSeriesPoint } from '../../db/types.ts'

import {
  getOuraDailyActivityPage,
  getOuraDerivedBackfillCounts,
  insertTimeSeries,
  type RawDailyActivityRow,
} from '../../db/index.ts'
import { activityContributorPoints, ouraDailyRecordTime } from '../../integrations/oura/process.ts'

const PAGE_SIZE = 1000

/** Contributor points from stored daily_activity documents; documents with no day or timestamp are skipped. */
export const contributorPointsFromRecords = (rows: RawDailyActivityRow[]): TimeSeriesPoint[] =>
  rows.flatMap(({ data }) => {
    const day = typeof data.day === 'string' ? data.day : undefined
    const timestamp = typeof data.timestamp === 'string' ? data.timestamp : undefined
    if (!day && !timestamp) return []
    const contributors = data.contributors
    if (typeof contributors !== 'object' || contributors === null) return []
    return activityContributorPoints(
      { contributors: contributors as Record<string, number | null> },
      ouraDailyRecordTime({ day, timestamp }),
    )
  })

/** Re-derive the activity-score contributor metrics from every stored Oura daily_activity document. Idempotent. */
export const backfillOuraDerivedMetrics = async (user: string): Promise<OuraMetricBackfillData> => {
  let after: RawDailyActivityRow | null = null
  let records = 0
  let written = 0
  for (;;) {
    const page = await getOuraDailyActivityPage(user, after, PAGE_SIZE)
    if (page.length === 0) break
    records += page.length
    const points = contributorPointsFromRecords(page)
    await insertTimeSeries(user, points)
    written += points.length
    after = page.at(-1)!
    if (page.length < PAGE_SIZE) break
  }
  return { daily_activity_records: records, points_written: written }
}

export const needsOuraDerivedBackfill = async (user: string): Promise<boolean> => {
  const { documents, stamped } = await getOuraDerivedBackfillCounts(user, activityContributorMetrics)
  return documents > stamped
}

/** Startup pass: backfill each user that needs it, one at a time; failures are logged, never thrown. */
export const backfillOuraDerivedMetricsForUsers = async (
  users: string[],
  deps = { backfill: backfillOuraDerivedMetrics, needs: needsOuraDerivedBackfill },
): Promise<void> => {
  for (const user of users) {
    try {
      if (!(await deps.needs(user))) continue
      const { daily_activity_records: records, points_written: points } = await deps.backfill(user)
      console.info(`📈 Oura contributor backfill for ${user}: ${points} points from ${records} documents`)
    } catch (error) {
      console.error(`⚠️ Oura contributor backfill failed for ${user}:`, error)
    }
  }
}
