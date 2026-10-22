import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { OuraWorkoutRaw } from '../../integrations/oura/client.ts'

import { query } from '../../db/connection.ts'
import { insertActivity, insertTimeSeries } from '../../db/index.ts'
import { retypeOuraWorkouts } from '../../db/workout-migrations.ts'
import { processOuraData } from '../../integrations/oura/process.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../../test/db-test-helper.ts'
import {
  deleteStrengthSet,
  getWorkoutDetail,
  linkWorkouts,
  listWorkouts,
  logStrength,
  reconcileStrengthWorkouts,
  strengthProgress,
  unlinkWorkouts,
  updateStrengthSet,
} from './service.ts'

const CONTAINER_TIMEOUT = 120_000
const tz = 'Europe/Ljubljana'

const ouraWorkout = (over: Partial<OuraWorkoutRaw> & { id: string }): OuraWorkoutRaw => ({
  activity: 'strengthTraining',
  calories: 262,
  day: '2026-10-20',
  distance: 45,
  end_datetime: '2026-10-20T19:00:00+02:00',
  intensity: 'moderate',
  label: null,
  source: 'manual',
  start_datetime: '2026-10-20T18:00:00+02:00',
  ...over,
})

const day = { end: new Date('2026-10-20T22:00:00Z'), start: new Date('2026-10-19T22:00:00Z') }

const log = async (text: string, messageTime: string, extra: Record<string, unknown> = {}) => {
  const outcome = await logStrength(
    getTestUser(),
    { entry_channel: 'hermes', message_time: messageTime, text, tz, ...extra },
    new Date(messageTime),
  )
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome.result
}

const strengthWorkouts = async () =>
  (await listWorkouts(getTestUser(), day)).filter((w) => w.activity_type === 'strength_training')

const countActivities = async (): Promise<number> =>
  (await query(getTestUser(), `SELECT COUNT(*)::int AS n FROM activities WHERE deleted_at IS NULL`)).rows[0].n

describe('unified workouts', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('Oura workouts get specific types and touching sessions stay separate', async () => {
    const user = getTestUser()
    await processOuraData(user, 'workouts', [
      ouraWorkout({
        activity: 'walking',
        end_datetime: '2026-10-20T13:03:00+02:00',
        id: 'walk',
        source: 'confirmed',
        start_datetime: '2026-10-20T12:48:00+02:00',
      }),
      ouraWorkout({
        activity: 'wrestling',
        end_datetime: '2026-10-20T13:57:00+02:00',
        id: 'wrestle',
        start_datetime: '2026-10-20T12:57:00+02:00',
      }),
      ouraWorkout({
        activity: 'cycling',
        end_datetime: '2026-10-20T17:15:00+02:00',
        id: 'ride',
        start_datetime: '2026-10-20T16:45:00+02:00',
      }),
    ])
    const list = await listWorkouts(user, day)
    expect(list.map((w) => w.activity_type).sort()).toEqual(['biking', 'walking', 'wrestling'])
    const wrestling = list.find((w) => w.activity_type === 'wrestling')!
    expect(list.find((w) => w.activity_type === 'biking')?.icon).toBe('🚴')
    expect(wrestling).toMatchObject({
      icon: '🤼',
      calories: 262,
      sets_status: 'not_applicable',
      sources: ['oura'],
      title: 'Wrestling',
    })
  })

  test('Case A: Oura first, Telegram later gives one workout with both', async () => {
    const user = getTestUser()
    await processOuraData(user, 'workouts', [ouraWorkout({ id: 'oura-a' })])
    const result = await log('bench press 5x5 50kg, squat 3x8 70kg', '2026-10-20T17:20:00Z')

    expect(result.created).toBe(true)
    expect(result.link?.status).toBe('confirmed')
    expect(result.summary_text).toContain('Bench Press — 5×5 @ 50 kg\nSquat — 3×8 @ 70 kg')
    expect(result.summary_text).toContain('Total volume: 2,930 kg')
    expect(result.summary_text).toContain('Merged with Oura session 18:00–19:00')

    const workouts = await strengthWorkouts()
    expect(workouts).toHaveLength(1)
    expect(workouts[0]).toMatchObject({
      calories: 262,
      set_count: 8,
      sets_status: 'logged',
      start_time: '2026-10-20T16:00:00.000Z',
      volume_kg: 2930,
    })
    expect(workouts[0]!.sources.sort()).toEqual(['hermes', 'oura'])

    const detail = await getWorkoutDetail(user, workouts[0]!.id, tz)
    expect(detail!.provenance).toMatchObject({ calories: 'oura', sets: 'hermes', time: 'oura' })
  })

  test('an Oura resync never duplicates the workout or touches the sets', async () => {
    const user = getTestUser()
    await processOuraData(user, 'workouts', [ouraWorkout({ id: 'oura-a' })])
    await log('bench 5x5 50kg', '2026-10-20T17:20:00Z')
    const before = await countActivities()

    await processOuraData(user, 'workouts', [ouraWorkout({ calories: 300, id: 'oura-a' })])
    await processOuraData(user, 'workouts', [ouraWorkout({ calories: 300, id: 'oura-a' })])

    expect(await countActivities()).toBe(before)
    const workouts = await strengthWorkouts()
    expect(workouts).toHaveLength(1)
    expect(workouts[0]).toMatchObject({ calories: 300, set_count: 5 })
  })

  test('Case B: Telegram first, Oura later is reconciled on import', async () => {
    const user = getTestUser()
    const first = await log('bench 5x5 50kg', '2026-10-20T17:20:00Z')
    expect(first.link).toBeUndefined()
    expect(await strengthWorkouts()).toHaveLength(1)

    await processOuraData(user, 'workouts', [ouraWorkout({ id: 'oura-b' })])

    const workouts = await strengthWorkouts()
    expect(workouts).toHaveLength(1)
    expect(workouts[0]).toMatchObject({ calories: 262, set_count: 5 })
  })

  test('Case C: Telegram only keeps a complete workout without invented metrics', async () => {
    await log('Yesterday did 4 sets of 10 pullups', '2026-10-21T09:00:00Z')
    const [workout] = await strengthWorkouts()
    expect(workout).toMatchObject({
      calories: undefined,
      hr_avg: undefined,
      set_count: 4,
      sources: ['hermes'],
    })
    const detail = await getWorkoutDetail(getTestUser(), workout!.id, tz)
    expect(detail!.time_source).toBe('date_only')
    expect(detail!.heart_rate.status).toBe('unavailable')
    expect(detail!.sets[0]).toMatchObject({ bodyweight: true, exercise_key: 'pull_up', reps: 10, weight: 0 })
  })

  test('Case D: Oura only shows the session with sets not logged', async () => {
    await processOuraData(getTestUser(), 'workouts', [ouraWorkout({ id: 'oura-d' })])
    const [workout] = await strengthWorkouts()
    expect(workout).toMatchObject({ set_count: 0, sets_status: 'not_logged' })
  })

  test('Case E: two sessions on one day stay separate and the sets join the right one', async () => {
    const user = getTestUser()
    await processOuraData(user, 'workouts', [
      ouraWorkout({
        end_datetime: '2026-10-20T08:00:00+02:00',
        id: 'morning',
        start_datetime: '2026-10-20T07:00:00+02:00',
      }),
      ouraWorkout({ id: 'evening' }),
    ])
    await log('squat 3x5 100kg', '2026-10-20T17:15:00Z')

    const workouts = await strengthWorkouts()
    expect(workouts).toHaveLength(2)
    const evening = workouts.find((w) => w.start_time === '2026-10-20T16:00:00.000Z')!
    const morning = workouts.find((w) => w.start_time === '2026-10-20T05:00:00.000Z')!
    expect(evening.set_count).toBe(3)
    expect(morning.sets_status).toBe('not_logged')
  })

  test('two candidate sessions leave the sets unmerged with suggestions', async () => {
    const user = getTestUser()
    await processOuraData(user, 'workouts', [
      ouraWorkout({
        end_datetime: '2026-10-20T18:00:00+02:00',
        id: 'first',
        start_datetime: '2026-10-20T17:00:00+02:00',
      }),
      ouraWorkout({
        end_datetime: '2026-10-20T20:00:00+02:00',
        id: 'second',
        start_datetime: '2026-10-20T19:00:00+02:00',
      }),
    ])
    const result = await log('bench 5x5 50kg', '2026-10-20T16:30:00Z')
    expect(result.link).toBeUndefined()
    expect(result.workout!.suggestions.length).toBeGreaterThan(0)
    expect(result.summary_text).toContain('not merged')
    expect(await strengthWorkouts()).toHaveLength(3)

    const linked = await linkWorkouts(user, result.workout!.id, result.workout!.suggestions[0]!.activity_id)
    expect('error' in linked).toBe(false)
    expect(await strengthWorkouts()).toHaveLength(2)
  })

  test('messages within the session gap append; a later session starts a new workout', async () => {
    await log('bench 5x5 50kg', '2026-10-20T07:00:00Z')
    const second = await log('squat 3x8 70kg', '2026-10-20T07:30:00Z')
    expect(second.created).toBe(false)
    expect(second.workout!.set_count).toBe(8)
    const third = await log('deadlift 3x5 90kg', '2026-10-20T15:00:00Z')
    expect(third.created).toBe(true)
    expect(await strengthWorkouts()).toHaveLength(2)
  })

  test('a retried message with the same idempotency key is logged once', async () => {
    const extra = { idempotency_key: 'telegram:1:42' }
    const first = await log('bench 5x5 50kg', '2026-10-20T07:00:00Z', extra)
    const retry = await log('bench 5x5 50kg', '2026-10-20T07:00:00Z', extra)
    expect(retry.replayed).toBe(true)
    expect(retry.workout!.id).toBe(first.workout!.id)
    const [workout] = await strengthWorkouts()
    expect(workout!.set_count).toBe(5)
  })

  test('a dry run writes nothing', async () => {
    const result = await log('bench 5x5 50kg', '2026-10-20T07:00:00Z', { dry_run: true })
    expect(result.dry_run).toBe(true)
    expect(result.summary_text).toContain('nothing saved')
    expect(await countActivities()).toBe(0)
  })

  test('unlink separates the pair, restores the logged time and is not undone by the next sync', async () => {
    const user = getTestUser()
    await processOuraData(user, 'workouts', [ouraWorkout({ id: 'oura-u' })])
    const result = await log('bench 5x5 50kg', '2026-10-20T17:20:00Z')
    const ouraId = result.workout!.member_ids.find((id) => id !== result.workout!.id)!

    await unlinkWorkouts(user, result.workout!.id, ouraId)
    let workouts = await strengthWorkouts()
    expect(workouts).toHaveLength(2)
    expect(workouts.find((w) => w.id === result.workout!.id)!.start_time).toBe('2026-10-20T17:20:00.000Z')

    await processOuraData(user, 'workouts', [ouraWorkout({ id: 'oura-u' })])
    await reconcileStrengthWorkouts(user, new Date('2026-10-20T17:00:00Z'))
    workouts = await strengthWorkouts()
    expect(workouts).toHaveLength(2)
  })

  test('an automatic link drops back to a suggestion when Oura moves the session away', async () => {
    const user = getTestUser()
    await processOuraData(user, 'workouts', [ouraWorkout({ id: 'oura-m' })])
    await log('bench 5x5 50kg', '2026-10-20T17:20:00Z')
    expect(await strengthWorkouts()).toHaveLength(1)

    await processOuraData(user, 'workouts', [
      ouraWorkout({
        end_datetime: '2026-10-20T09:00:00+02:00',
        id: 'oura-m',
        start_datetime: '2026-10-20T08:00:00+02:00',
      }),
    ])
    const workouts = await strengthWorkouts()
    expect(workouts).toHaveLength(2)
    expect(workouts.find((w) => w.set_count === 5)!.start_time).toBe('2026-10-20T17:20:00.000Z')
  })

  test('sets can be corrected and deleted; synced rows are not editable here', async () => {
    const user = getTestUser()
    const result = await log('bench 5x5 50kg', '2026-10-20T07:00:00Z')
    const last = result.workout!.sets.at(-1)!
    const updated = await updateStrengthSet(user, result.workout!.id, last.set_id!, { weight: 55 }, tz)
    expect('error' in updated).toBe(false)
    if ('error' in updated) return
    expect(updated.workout.sets.at(-1)!.weight).toBe(55)
    expect(updated.workout.volume_kg).toBe(1275)

    const deleted = await deleteStrengthSet(user, result.workout!.id, result.workout!.sets[0]!.set_id!, tz)
    expect('error' in deleted ? deleted.error : deleted.workout.set_count).toBe(4)

    await insertActivity(user, {
      activity_type: 'strength_training',
      data: {
        sets: [{ exercise: 'Bench Press', order: 1, reps: 5, set_id: 'g1', set_type: 'normal', weight: 60 }],
      },
      end_time: new Date('2026-10-18T10:00:00Z'),
      external_id: 'gravl-workout-1',
      source: 'gravl',
      start_time: new Date('2026-10-18T09:00:00Z'),
    })
    const gravl = (
      await listWorkouts(user, {
        end: new Date('2026-10-19T00:00:00Z'),
        start: new Date('2026-10-17T00:00:00Z'),
      })
    )[0]!
    const refused = await updateStrengthSet(user, gravl.id, 'g1', { weight: 70 }, tz)
    expect(refused).toEqual({ error: 'Sets synced from gravl are edited at the source' })
  })

  test('progress reads every logged session of the exercise', async () => {
    await log('bench 5x5 50kg', '2026-09-01T17:00:00Z')
    await log('bench 3x5 60kg', '2026-09-15T17:00:00Z')
    await log('bench 1x3 70kg', '2026-10-20T17:00:00Z')
    const p = await strengthProgress(getTestUser(), 'bench', { tz })
    expect(p.exercise).toEqual({ key: 'bench_press', name: 'Bench Press' })
    expect(p.sessions.map((s) => s.top_set?.weight)).toEqual([50, 60, 70])
    expect(p.prs.heaviest_set?.weight).toBe(70)
    expect(p.prs.best_volume_session?.volume_kg).toBe(1250)
  })

  test('heart rate inside the session is summarized with its coverage', async () => {
    const user = getTestUser()
    await processOuraData(user, 'workouts', [ouraWorkout({ id: 'oura-hr' })])
    const start = new Date('2026-10-20T16:00:00Z').getTime()
    await insertTimeSeries(
      user,
      Array.from({ length: 20 }, (_, i) => ({
        metric: 'heart_rate' as const,
        source: 'oura' as const,
        time: new Date(start + i * 60_000),
        value: 100 + i,
      })),
    )
    const [workout] = await strengthWorkouts()
    const detail = await getWorkoutDetail(user, workout!.id, tz)
    expect(detail!.heart_rate).toMatchObject({ avg: 110, max: 119, sample_count: 20, status: 'sparse' })
    expect(detail!.heart_rate.coverage).toBeCloseTo(0.33, 1)
  })

  test('the one-time migration retypes stored generic Oura workouts', async () => {
    const user = getTestUser()
    await query(
      user,
      `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    )
    await query(user, `DELETE FROM schema_migrations WHERE name = 'oura_workout_types_v1'`)
    await insertActivity(user, {
      activity_type: 'exercise',
      data: { activity: 'wrestling' },
      end_time: new Date('2026-09-13T11:57:00Z'),
      external_id: 'legacy-wrestle',
      source: 'oura',
      start_time: new Date('2026-09-13T10:57:00Z'),
      title: 'wrestling',
    })
    await insertActivity(user, {
      activity_type: 'exercise',
      data: { activity: 'walking' },
      end_time: new Date('2026-09-13T11:03:00Z'),
      external_id: 'legacy-walk',
      source: 'oura',
      start_time: new Date('2026-09-13T10:48:00Z'),
    })

    expect(await retypeOuraWorkouts(user)).toEqual({ days: 1, retyped: 2 })
    expect(await retypeOuraWorkouts(user)).toEqual({ days: 0, retyped: 0 })

    const rows = await query(
      user,
      `SELECT external_id, activity_type, superseded_by, title FROM activities WHERE source = 'oura' ORDER BY external_id`,
    )
    expect(rows.rows).toEqual([
      { activity_type: 'walking', external_id: 'legacy-walk', superseded_by: null, title: null },
      { activity_type: 'wrestling', external_id: 'legacy-wrestle', superseded_by: null, title: 'Wrestling' },
    ])
  })
})
