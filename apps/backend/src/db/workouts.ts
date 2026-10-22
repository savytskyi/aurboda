import type { Activity } from './types.ts'

import { activityColumns } from './activities/queries.ts'
import { query } from './connection.ts'
import { mapActivityRow } from './row-mappers.ts'
import { getSourceFilter } from './time-series.ts'

export type WorkoutLinkStatus = 'confirmed' | 'suggested' | 'rejected'

export interface WorkoutLinkRow {
  primary_id: string
  linked_id: string
  status: WorkoutLinkStatus
  method: 'auto' | 'user'
  confidence: number
  reasons: string[]
  restore: Record<string, unknown> | null
  created_at: Date
}

const mapLink = (row: Record<string, unknown>): WorkoutLinkRow => ({
  confidence: Number(row.confidence),
  created_at: row.created_at as Date,
  linked_id: row.linked_id as string,
  method: row.method as 'auto' | 'user',
  primary_id: row.primary_id as string,
  reasons: (row.reasons as string[]) ?? [],
  restore: (row.restore as Record<string, unknown> | null) ?? null,
  status: row.status as WorkoutLinkStatus,
})

/** Exercise-category activities (any source, not deleted) starting in the window. */
export const getExerciseActivitiesInRange = async (
  user: string,
  start: Date,
  end: Date,
): Promise<Activity[]> => {
  const result = await query(
    user,
    `SELECT ${activityColumns('a')}
       FROM activities a
       JOIN activity_type_definitions d ON d.name = a.activity_type
      WHERE a.deleted_at IS NULL
        AND d.display_category = 'exercise'
        AND a.start_time >= $1 AND a.start_time <= $2
      ORDER BY a.start_time`,
    [start, end],
  )
  return result.rows.map(mapActivityRow)
}

export const getActivitiesByIds = async (user: string, ids: string[]): Promise<Activity[]> => {
  if (ids.length === 0) return []
  const result = await query(
    user,
    `SELECT ${activityColumns('a')} FROM activities a WHERE a.id = ANY($1::uuid[])`,
    [ids],
  )
  return result.rows.map(mapActivityRow)
}

/** Live activities in the window carrying logged sets, for strength progression. */
export const getActivitiesWithSets = async (user: string, start?: Date, end?: Date): Promise<Activity[]> => {
  const result = await query(
    user,
    `SELECT ${activityColumns('a')}
       FROM activities a
      WHERE a.deleted_at IS NULL
        AND jsonb_typeof(a.data->'sets') = 'array'
        AND jsonb_array_length(a.data->'sets') > 0
        AND ($1::timestamptz IS NULL OR a.start_time >= $1)
        AND ($2::timestamptz IS NULL OR a.start_time <= $2)
        AND NOT EXISTS (
          SELECT 1 FROM activities w
           WHERE w.id = a.superseded_by AND w.deleted_at IS NULL
             AND jsonb_typeof(w.data->'sets') = 'array' AND jsonb_array_length(w.data->'sets') > 0
        )
      ORDER BY a.start_time`,
    [start ?? null, end ?? null],
  )
  return result.rows.map(mapActivityRow)
}

export const getManualStrengthWorkouts = async (
  user: string,
  start: Date,
  end: Date,
): Promise<Activity[]> => {
  const result = await query(
    user,
    `SELECT ${activityColumns('a')}
       FROM activities a
      WHERE a.deleted_at IS NULL AND a.source = 'aurboda'
        AND (a.data->>'manual_strength')::boolean IS TRUE
        AND a.start_time >= $1 AND a.start_time <= $2
      ORDER BY a.start_time`,
    [start, end],
  )
  return result.rows.map(mapActivityRow)
}

export const getStrengthCandidates = async (
  user: string,
  start: Date,
  end: Date,
  types: string[],
): Promise<Activity[]> => {
  const result = await query(
    user,
    `SELECT ${activityColumns('a')}
       FROM activities a
      WHERE a.deleted_at IS NULL
        AND NOT ((a.data->>'manual_strength')::boolean IS TRUE)
        AND a.activity_type = ANY($3::text[])
        AND a.start_time >= $1 AND a.start_time <= $2
      ORDER BY a.start_time`,
    [start, end, types],
  )
  return result.rows.map(mapActivityRow)
}

export const updateWorkoutRow = async (
  user: string,
  id: string,
  fields: { data: Record<string, unknown>; start_time?: Date; end_time?: Date | null },
): Promise<void> => {
  await query(
    user,
    `UPDATE activities
        SET data = $2,
            start_time = COALESCE($3, start_time),
            end_time = CASE WHEN $5 THEN $4 ELSE end_time END
      WHERE id = $1`,
    [id, fields.data, fields.start_time ?? null, fields.end_time ?? null, fields.end_time !== undefined],
  )
}

export const getWorkoutLinksFor = async (user: string, ids: string[]): Promise<WorkoutLinkRow[]> => {
  if (ids.length === 0) return []
  const result = await query(
    user,
    `SELECT * FROM workout_links WHERE primary_id = ANY($1::uuid[]) OR linked_id = ANY($1::uuid[])
      ORDER BY created_at`,
    [ids],
  )
  return result.rows.map(mapLink)
}

export const getWorkoutLink = async (user: string, a: string, b: string): Promise<WorkoutLinkRow | null> => {
  const result = await query(
    user,
    `SELECT * FROM workout_links
      WHERE (primary_id = $1 AND linked_id = $2) OR (primary_id = $2 AND linked_id = $1)`,
    [a, b],
  )
  return result.rows[0] ? mapLink(result.rows[0]) : null
}

/** Insert or update the link between the pair, whichever way round it was stored. */
export const upsertWorkoutLink = async (
  user: string,
  link: Omit<WorkoutLinkRow, 'created_at' | 'restore'> & { restore?: Record<string, unknown> | null },
): Promise<WorkoutLinkRow> => {
  const existing = await getWorkoutLink(user, link.primary_id, link.linked_id)
  const restore = link.restore === undefined ? (existing?.restore ?? null) : link.restore
  const result = existing
    ? await query(
        user,
        `UPDATE workout_links
            SET status = $3, method = $4, confidence = $5, reasons = $6::jsonb, restore = $7::jsonb, updated_at = NOW()
          WHERE primary_id = $1 AND linked_id = $2
        RETURNING *`,
        [
          existing.primary_id,
          existing.linked_id,
          link.status,
          link.method,
          link.confidence,
          JSON.stringify(link.reasons),
          restore === null ? null : JSON.stringify(restore),
        ],
      )
    : await query(
        user,
        `INSERT INTO workout_links (primary_id, linked_id, status, method, confidence, reasons, restore)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
         RETURNING *`,
        [
          link.primary_id,
          link.linked_id,
          link.status,
          link.method,
          link.confidence,
          JSON.stringify(link.reasons),
          restore === null ? null : JSON.stringify(restore),
        ],
      )
  return mapLink(result.rows[0]!)
}

export const deleteSuggestedLinks = async (
  user: string,
  primaryId: string,
  keep: string[],
): Promise<void> => {
  await query(
    user,
    `DELETE FROM workout_links
      WHERE primary_id = $1 AND status = 'suggested' AND NOT (linked_id = ANY($2::uuid[]))`,
    [primaryId, keep],
  )
}

export interface HrWindowStats {
  sample_count: number
  avg?: number
  max?: number
  covered_minutes: number
}

/** Heart-rate sample statistics per `[start, end]` window, index-aligned. */
export const getHrStatsForWindows = async (
  user: string,
  windows: { start: Date; end: Date }[],
): Promise<HrWindowStats[]> => {
  if (windows.length === 0) return []
  const sources = getSourceFilter('heart_rate')
  const params: unknown[] = [windows.map((w) => w.start), windows.map((w) => w.end)]
  if (sources) params.push(sources)
  const result = await query(
    user,
    `SELECT w.i::int AS i,
            COUNT(ts.value)::int AS n,
            AVG(ts.value)::float8 AS avg,
            MAX(ts.value)::float8 AS max,
            COUNT(DISTINCT date_trunc('minute', ts.time))::int AS minutes
       FROM unnest($1::timestamptz[], $2::timestamptz[]) WITH ORDINALITY AS w(s, e, i)
       LEFT JOIN time_series ts
         ON ts.metric = 'heart_rate' AND ts.deleted_at IS NULL
        AND ts.time >= w.s AND ts.time <= w.e
        ${sources ? 'AND ts.source = ANY($3)' : ''}
      GROUP BY w.i`,
    params,
  )
  const stats: HrWindowStats[] = windows.map(() => ({ covered_minutes: 0, sample_count: 0 }))
  for (const row of result.rows) {
    const n = Number(row.n)
    stats[Number(row.i) - 1] = {
      avg: n > 0 ? Number(row.avg) : undefined,
      covered_minutes: Number(row.minutes),
      max: n > 0 ? Number(row.max) : undefined,
      sample_count: n,
    }
  }
  return stats
}

export const getActivityNotes = async (user: string, ids: string[]): Promise<Map<string, string[]>> => {
  const notes = new Map<string, string[]>()
  if (ids.length === 0) return notes
  const result = await query(
    user,
    `SELECT entity_id, content FROM notes
      WHERE entity_type = 'activity' AND entity_id = ANY($1::text[])
      ORDER BY created_at`,
    [ids],
  )
  for (const row of result.rows) {
    const list = notes.get(row.entity_id as string) ?? []
    list.push(row.content as string)
    notes.set(row.entity_id as string, list)
  }
  return notes
}

export interface CustomExerciseRow {
  key: string
  name: string
  aliases: string[]
  category?: string
  muscle_group?: string
  equipment?: string
  is_bodyweight: boolean
}

export const listCustomExercises = async (user: string): Promise<CustomExerciseRow[]> => {
  const result = await query(user, `SELECT * FROM exercise_definitions ORDER BY name`)
  return result.rows.map((r) => ({
    aliases: (r.aliases as string[]) ?? [],
    category: (r.category as string | null) ?? undefined,
    equipment: (r.equipment as string | null) ?? undefined,
    is_bodyweight: r.is_bodyweight as boolean,
    key: r.key as string,
    muscle_group: (r.muscle_group as string | null) ?? undefined,
    name: r.name as string,
  }))
}

export const upsertCustomExercise = async (user: string, def: CustomExerciseRow): Promise<void> => {
  await query(
    user,
    `INSERT INTO exercise_definitions (key, name, aliases, category, muscle_group, equipment, is_bodyweight)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (key) DO UPDATE SET
       name = EXCLUDED.name, aliases = EXCLUDED.aliases, category = EXCLUDED.category,
       muscle_group = EXCLUDED.muscle_group, equipment = EXCLUDED.equipment, is_bodyweight = EXCLUDED.is_bodyweight`,
    [
      def.key,
      def.name,
      def.aliases,
      def.category ?? null,
      def.muscle_group ?? null,
      def.equipment ?? null,
      def.is_bodyweight,
    ],
  )
}

/** Logged set count and last use per exercise key, over live activities. */
export const getExerciseUsage = async (user: string): Promise<Map<string, { sets: number; last: Date }>> => {
  const result = await query(
    user,
    `SELECT COALESCE(s->>'exercise_key', lower(regexp_replace(s->>'exercise', '[^A-Za-z0-9]+', '_', 'g'))) AS key,
            COUNT(*)::int AS sets, MAX(a.start_time) AS last
       FROM activities a, jsonb_array_elements(a.data->'sets') s
      WHERE a.deleted_at IS NULL AND jsonb_typeof(a.data->'sets') = 'array'
      GROUP BY 1`,
  )
  return new Map(result.rows.map((r) => [r.key as string, { last: r.last as Date, sets: Number(r.sets) }]))
}

export interface IdempotencyRecord {
  request_hash: string
  response: Record<string, unknown>
}

/**
 * Claim `key` for this request. Returns null when the claim is new; otherwise
 * the stored record, whose `response.pending` is true while the first
 * request is still running.
 */
export const claimIdempotencyKey = async (
  user: string,
  scope: string,
  key: string,
  requestHash: string,
): Promise<IdempotencyRecord | null> => {
  const inserted = await query(
    user,
    `INSERT INTO api_idempotency_keys (scope, key, request_hash, response)
     VALUES ($1, $2, $3, '{"pending": true}'::jsonb)
     ON CONFLICT (scope, key) DO NOTHING
     RETURNING key`,
    [scope, key, requestHash],
  )
  if (inserted.rows.length > 0) return null
  return getIdempotencyRecord(user, scope, key)
}

export const getIdempotencyRecord = async (
  user: string,
  scope: string,
  key: string,
): Promise<IdempotencyRecord | null> => {
  const result = await query(
    user,
    `SELECT request_hash, response FROM api_idempotency_keys WHERE scope = $1 AND key = $2`,
    [scope, key],
  )
  const row = result.rows[0]
  return row
    ? { request_hash: row.request_hash as string, response: row.response as Record<string, unknown> }
    : null
}

export const completeIdempotencyKey = async (
  user: string,
  scope: string,
  key: string,
  response: Record<string, unknown>,
): Promise<void> => {
  await query(user, `UPDATE api_idempotency_keys SET response = $3::jsonb WHERE scope = $1 AND key = $2`, [
    scope,
    key,
    JSON.stringify(response),
  ])
}

export const releaseIdempotencyKey = async (user: string, scope: string, key: string): Promise<void> => {
  await query(
    user,
    `DELETE FROM api_idempotency_keys WHERE scope = $1 AND key = $2 AND (response->>'pending')::boolean IS TRUE`,
    [scope, key],
  )
}
