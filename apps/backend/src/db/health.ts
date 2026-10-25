import { query } from './connection.ts'

export interface HealthDayValue {
  date: string
  metric: string
  value: number
}

/**
 * One value per (local day in `tz`, metric) from the stored rows. Oura's value
 * wins when several sources wrote the same day; otherwise the sources are
 * averaged. Reads `time_series` directly, so contextual metrics such as
 * `hrv_sleep` come back as stored (Oura's nightly average), not recomputed.
 */
export const getDailyMetricValues = async (
  user: string,
  metrics: string[],
  start: Date,
  end: Date,
  tz: string,
): Promise<HealthDayValue[]> => {
  if (metrics.length === 0) return []
  const result = await query<{ date: string; metric: string; value: number }>(
    user,
    `SELECT to_char((time AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS date,
            metric,
            COALESCE(AVG(value) FILTER (WHERE source = 'oura'), AVG(value)) AS value
       FROM time_series
      WHERE metric = ANY($1) AND deleted_at IS NULL AND time >= $2 AND time < $3
      GROUP BY 1, metric
      ORDER BY metric, 1`,
    [metrics, start, end, tz],
  )
  return result.rows.map((r) => ({ date: r.date, metric: r.metric, value: Number(r.value) }))
}

export interface SleepSessionRow {
  start_time: Date
  end_time: Date
  source: string
  oura_type: string | null
}

/** `sleep` activities whose wake-up falls in `[start, end)`. */
export const getSleepSessionsEndingBetween = async (
  user: string,
  start: Date,
  end: Date,
): Promise<SleepSessionRow[]> => {
  const result = await query<SleepSessionRow>(
    user,
    `SELECT start_time, end_time, source, data->>'ouraType' AS oura_type
       FROM activities
      WHERE activity_type = 'sleep' AND deleted_at IS NULL
        AND end_time IS NOT NULL AND end_time > start_time
        AND end_time >= $1 AND end_time < $2
      ORDER BY end_time`,
    [start, end],
  )
  return result.rows
}

export interface SleepTimeRecord {
  day: string
  status: string
  recommendation: string | null
  optimal_bedtime: { day_tz?: number; start_offset: number; end_offset: number } | null
}

/**
 * The latest Oura `sleep_time` document for a day on or before `endDay`, and
 * the latest one in that range that carries an optimal bedtime window.
 */
export const getSleepTimeRecords = async (
  user: string,
  endDay: string,
): Promise<{ latest: SleepTimeRecord | null; latest_with_optimal: SleepTimeRecord | null }> => {
  const pick = async (extra: string) =>
    (
      await query<{ data: SleepTimeRecord }>(
        user,
        `SELECT data FROM raw_records
          WHERE source = 'oura' AND record_type = 'sleep_time' AND data->>'day' <= $1 ${extra}
          ORDER BY data->>'day' DESC, recorded_at DESC
          LIMIT 1`,
        [endDay],
      )
    ).rows[0]?.data ?? null
  const [latest, latestWithOptimal] = await Promise.all([
    pick(''),
    pick(`AND jsonb_typeof(data->'optimal_bedtime') = 'object'`),
  ])
  return { latest, latest_with_optimal: latestWithOptimal }
}

/** Age from the most recently fetched Oura `personal_info` document. */
export const getLatestOuraPersonalInfo = async (
  user: string,
): Promise<{ age: number; received_at: Date } | null> => {
  const result = await query<{ age: number | null; received_at: Date }>(
    user,
    `SELECT (data->>'age')::double precision AS age, received_at
       FROM raw_records
      WHERE source = 'oura' AND record_type = 'personal_info' AND jsonb_typeof(data->'age') = 'number'
      ORDER BY received_at DESC
      LIMIT 1`,
  )
  const row = result.rows[0]
  return row && row.age !== null ? { age: Number(row.age), received_at: row.received_at } : null
}

export interface TagOccurrenceRow {
  activity_type: string
  display_name: string | null
  start_time: Date
}

/** Oura tags (activities carrying a `tag_key`) starting in `[start, end)`. */
export const getOuraTagOccurrences = async (
  user: string,
  start: Date,
  end: Date,
): Promise<TagOccurrenceRow[]> => {
  const result = await query<TagOccurrenceRow>(
    user,
    `SELECT a.activity_type, d.display_name, a.start_time
       FROM activities a
       LEFT JOIN activity_type_definitions d ON d.name = a.activity_type
      WHERE a.source = 'oura' AND a.deleted_at IS NULL AND a.data ? 'tag_key'
        AND a.activity_type <> 'unknown'
        AND a.start_time >= $1 AND a.start_time < $2
      ORDER BY a.start_time`,
    [start, end],
  )
  return result.rows
}

export interface RawDailyActivityRow {
  id: string
  recorded_at: Date
  data: Record<string, unknown>
}

/** One keyset page of stored Oura `daily_activity` documents, by (recorded_at, id). */
export const getOuraDailyActivityPage = async (
  user: string,
  after: { recorded_at: Date; id: string } | null,
  limit: number,
): Promise<RawDailyActivityRow[]> => {
  const result = await query<RawDailyActivityRow>(
    user,
    `SELECT id, recorded_at, data FROM raw_records
      WHERE source = 'oura' AND record_type = 'daily_activity'
        AND ($1::timestamptz IS NULL OR (recorded_at, id) > ($1::timestamptz, $2::uuid))
      ORDER BY recorded_at, id
      LIMIT $3`,
    [after?.recorded_at ?? null, after?.id ?? null, limit],
  )
  return result.rows
}

/**
 * `documents`: distinct Oura daily_activity days (by stamp) whose stored
 * document has at least one numeric contributor. `stamped`: distinct times an
 * Oura activity-contributor metric is stored at. One document yields points at
 * exactly one time, so `documents > stamped` means some have not been derived.
 */
export const getOuraDerivedBackfillCounts = async (
  user: string,
  contributorMetrics: readonly string[],
): Promise<{ documents: number; stamped: number }> => {
  const result = await query<{ documents: number; stamped: number }>(
    user,
    `SELECT
       (SELECT COUNT(DISTINCT COALESCE(data->>'timestamp', data->>'day'))::int
          FROM raw_records
         WHERE source = 'oura' AND record_type = 'daily_activity' AND data ? 'contributors'
           AND COALESCE(data->>'timestamp', data->>'day') IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(data->'contributors') = 'object'
                                           THEN data->'contributors' ELSE '{}'::jsonb END) c
              WHERE jsonb_typeof(c.value) = 'number'
           )) AS documents,
       (SELECT COUNT(DISTINCT time)::int
          FROM time_series
         WHERE source = 'oura' AND metric = ANY($1) AND deleted_at IS NULL) AS stamped`,
    [contributorMetrics],
  )
  return result.rows[0] ?? { documents: 0, stamped: 0 }
}
