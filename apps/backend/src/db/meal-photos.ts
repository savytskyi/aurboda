import type { MealPhotoMeta } from './types.ts'

import { query } from './connection.ts'

const META_COLUMNS = 'id, meal_id, kind, content_type, sha256, width, height, created_at'

const mapMeta = (row: Record<string, unknown>): MealPhotoMeta => ({
  content_type: row.content_type as string,
  created_at: new Date(row.created_at as string),
  height: (row.height as number | null) ?? undefined,
  id: row.id as string,
  kind: row.kind as string,
  meal_id: row.meal_id as string,
  sha256: (row.sha256 as string | null) ?? undefined,
  width: (row.width as number | null) ?? undefined,
})

export interface UpsertMealPhotoInput {
  id: string
  meal_id: string
  kind: string
  content_type: string
  sha256?: string
  width?: number
  height?: number
  data: Buffer
}

/** Idempotent on photo id; returns null when the meal does not exist. */
export const upsertMealPhoto = async (
  user: string,
  input: UpsertMealPhotoInput,
): Promise<MealPhotoMeta | null> => {
  const result = await query(
    user,
    `INSERT INTO meal_photos (id, meal_id, kind, content_type, sha256, width, height, data)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8 WHERE EXISTS (SELECT 1 FROM meals WHERE id = $2)
     ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, content_type = EXCLUDED.content_type,
       sha256 = EXCLUDED.sha256, width = EXCLUDED.width, height = EXCLUDED.height, data = EXCLUDED.data
     WHERE meal_photos.meal_id = EXCLUDED.meal_id
     RETURNING ${META_COLUMNS}`,
    [
      input.id,
      input.meal_id,
      input.kind,
      input.content_type,
      input.sha256 ?? null,
      input.width ?? null,
      input.height ?? null,
      input.data,
    ],
  )
  return result.rows[0] ? mapMeta(result.rows[0]) : null
}

export const getMealPhotosBatch = async (
  user: string,
  mealIds: string[],
): Promise<Map<string, MealPhotoMeta[]>> => {
  const map = new Map<string, MealPhotoMeta[]>()
  if (mealIds.length === 0) return map
  const result = await query(
    user,
    `SELECT ${META_COLUMNS} FROM meal_photos WHERE meal_id = ANY($1::uuid[]) ORDER BY created_at, id`,
    [mealIds],
  )
  for (const row of result.rows) {
    const meta = mapMeta(row)
    const list = map.get(meta.meal_id) ?? []
    list.push(meta)
    map.set(meta.meal_id, list)
  }
  return map
}

export const getMealPhotoData = async (
  user: string,
  mealId: string,
  photoId: string,
): Promise<{ content_type: string; data: Buffer } | null> => {
  const result = await query(
    user,
    `SELECT content_type, data FROM meal_photos WHERE meal_id = $1 AND id = $2`,
    [mealId, photoId],
  )
  const row = result.rows[0]
  return row ? { content_type: row.content_type as string, data: row.data as Buffer } : null
}

export const deleteMealPhoto = async (user: string, mealId: string, photoId: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM meal_photos WHERE meal_id = $1 AND id = $2`, [
    mealId,
    photoId,
  ])
  return (result.rowCount ?? 0) > 0
}
