import { humanizeOuraActivity, ouraWorkoutActivityType } from '../integrations/oura/workout-types.ts'
import { materializeSuperseded } from './activities/supersession.ts'
import { ensureSchemaMigrationsTable, getDbForUser, query } from './connection.ts'

const MARKER = 'oura_workout_types_v1'

/**
 * Retype Oura workouts stored as the generic `exercise` to the specific type
 * their stored Oura label names, then recompute supersession for every day
 * touched: the generic rows had been merged into each other across unrelated
 * sessions. Row ids, external ids and data are untouched, so a later Oura
 * resync upserts onto the same rows. Gated by a marker so it runs once.
 */
export const retypeOuraWorkouts = async (user: string): Promise<{ retyped: number; days: number }> => {
  const db = await getDbForUser(user)
  await ensureSchemaMigrationsTable(db)
  const applied = await query(db, `SELECT 1 FROM schema_migrations WHERE name = $1`, [MARKER])
  if (applied.rows.length > 0) return { days: 0, retyped: 0 }

  const known = new Set(
    (await query(db, `SELECT name FROM activity_type_definitions`)).rows.map((r) => r.name as string),
  )
  const labels = await query(
    db,
    `SELECT DISTINCT data->>'activity' AS activity
       FROM activities
      WHERE source = 'oura' AND activity_type = 'exercise' AND data ? 'activity'`,
  )
  const mapping = labels.rows
    .map((r) => r.activity as string | null)
    .filter((activity): activity is string => !!activity)
    .map((activity) => [activity, ouraWorkoutActivityType(activity, known)] as const)

  let retyped = 0
  const days = new Set<string>()
  if (mapping.length > 0) {
    const updated = await query(
      db,
      `UPDATE activities AS a
          SET activity_type = m.activity_type,
              title = CASE WHEN a.title = m.activity THEN m.title ELSE a.title END
         FROM unnest($1::text[], $2::text[], $3::text[]) AS m(activity, activity_type, title)
        WHERE a.source = 'oura'
          AND a.activity_type = 'exercise'
          AND a.data->>'activity' = m.activity
          AND NOT EXISTS (
            SELECT 1 FROM activities c
             WHERE c.source = 'oura' AND c.external_id IS NULL AND a.external_id IS NULL
               AND c.activity_type = m.activity_type AND c.start_time = a.start_time
          )
      RETURNING a.start_time`,
      [
        mapping.map(([activity]) => activity),
        mapping.map(([, type]) => type),
        mapping.map(([activity]) => humanizeOuraActivity(activity) ?? activity),
      ],
    )
    retyped = updated.rowCount ?? 0
    for (const row of updated.rows) days.add((row.start_time as Date).toISOString().slice(0, 10))
  }

  for (const day of [...days].sort()) {
    await materializeSuperseded(user, new Date(`${day}T12:00:00Z`))
  }

  await query(db, `INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`, [MARKER])
  return { days: days.size, retyped }
}
