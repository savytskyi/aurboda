import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestDbClient, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  getDailyMetricValues,
  getLatestOuraPersonalInfo,
  getOuraDailyActivityPage,
  getOuraDerivedBackfillCounts,
  getOuraTagOccurrences,
  getSleepSessionsEndingBetween,
  getSleepTimeRecords,
} from './health.ts'
import { insertRawRecords } from './raw-records.ts'
import { insertTimeSeries } from './time-series.ts'

const CONTAINER_TIMEOUT = 120_000
const user = getTestUser()
const TZ = 'Europe/Ljubljana'

const sql = (text: string, params: unknown[] = []) => getTestDbClient().query(text, params)

const insertActivity = (
  source: string,
  type: string,
  start: string,
  end: string | null,
  data: Record<string, unknown>,
  deleted = false,
) =>
  sql(
    `INSERT INTO activities (source, activity_type, start_time, end_time, data, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [source, type, start, end, JSON.stringify(data), deleted ? new Date() : null],
  )

const raw = (
  record_type: string,
  external_id: string,
  data: Record<string, unknown>,
  recorded_at: string,
) => ({
  data,
  external_id,
  recorded_at: new Date(recorded_at),
  record_type,
  source: 'oura' as const,
})

describe('health db integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('getDailyMetricValues', () => {
    test('one value per local day and metric, Oura preferred over other sources, deleted rows ignored', async () => {
      await insertTimeSeries(user, [
        { metric: 'hrv_sleep', source: 'oura', time: new Date('2026-06-01T04:30:00Z'), value: 40 },
        { metric: 'hrv_sleep', source: 'garmin', time: new Date('2026-06-01T05:00:00Z'), value: 60 },
        { metric: 'hrv_sleep', source: 'garmin', time: new Date('2026-06-02T05:00:00Z'), value: 50 },
        { metric: 'hrv_sleep', source: 'health_connect', time: new Date('2026-06-02T06:00:00Z'), value: 70 },
        // 23:30 local on 2026-06-02 — still that day in Ljubljana, the next day in UTC.
        { metric: 'resting_heart_rate', source: 'oura', time: new Date('2026-06-02T21:30:00Z'), value: 52 },
        { metric: 'resting_heart_rate', source: 'oura', time: new Date('2026-06-04T04:00:00Z'), value: 99 },
        { metric: 'steps', source: 'oura', time: new Date('2026-06-01T10:00:00Z'), value: 1000 },
      ])
      await sql(`UPDATE time_series SET deleted_at = NOW() WHERE value = 99`)

      const rows = await getDailyMetricValues(
        user,
        ['hrv_sleep', 'resting_heart_rate'],
        new Date('2026-05-31T22:00:00Z'),
        new Date('2026-06-04T22:00:00Z'),
        TZ,
      )
      expect(rows).toEqual([
        { date: '2026-06-01', metric: 'hrv_sleep', value: 40 },
        { date: '2026-06-02', metric: 'hrv_sleep', value: 60 },
        { date: '2026-06-02', metric: 'resting_heart_rate', value: 52 },
      ])
    })

    test('no metrics, no query', async () => {
      expect(await getDailyMetricValues(user, [], new Date(0), new Date(), TZ)).toEqual([])
    })
  })

  describe('getSleepSessionsEndingBetween', () => {
    test('sleeps waking in the range, with their Oura type; deleted and other types excluded', async () => {
      await insertActivity('oura', 'sleep', '2026-06-01T21:00:00Z', '2026-06-02T05:00:00Z', {
        ouraType: 'long_sleep',
      })
      await insertActivity('garmin', 'sleep', '2026-06-02T21:00:00Z', '2026-06-03T05:00:00Z', {})
      await insertActivity('oura', 'sleep', '2026-06-03T21:00:00Z', '2026-06-04T05:00:00Z', {}, true)
      await insertActivity('oura', 'meditation', '2026-06-02T10:00:00Z', '2026-06-02T10:20:00Z', {})
      await insertActivity('oura', 'sleep', '2026-06-05T21:00:00Z', '2026-06-06T05:00:00Z', {})

      const rows = await getSleepSessionsEndingBetween(
        user,
        new Date('2026-06-02T00:00:00Z'),
        new Date('2026-06-05T00:00:00Z'),
      )
      expect(rows.map((r) => [r.source, r.oura_type, r.end_time.toISOString()])).toEqual([
        ['oura', 'long_sleep', '2026-06-02T05:00:00.000Z'],
        ['garmin', null, '2026-06-03T05:00:00.000Z'],
      ])
    })
  })

  describe('getSleepTimeRecords', () => {
    test('latest on or before the end day, and the latest with an optimal window', async () => {
      const window = { day_tz: 7200, end_offset: 1800, start_offset: -3600 }
      await insertRawRecords(user, [
        raw(
          'sleep_time',
          'st1',
          { day: '2026-06-01', optimal_bedtime: window, status: 'optimal_found' },
          '2026-06-01T00:00:00Z',
        ),
        raw(
          'sleep_time',
          'st2',
          { day: '2026-06-02', optimal_bedtime: null, status: 'not_enough_nights' },
          '2026-06-02T00:00:00Z',
        ),
        raw(
          'sleep_time',
          'st3',
          { day: '2026-06-05', optimal_bedtime: window, status: 'optimal_found' },
          '2026-06-05T00:00:00Z',
        ),
      ])
      const { latest, latest_with_optimal } = await getSleepTimeRecords(user, '2026-06-03')
      expect(latest?.day).toBe('2026-06-02')
      expect(latest_with_optimal?.day).toBe('2026-06-01')
      expect(await getSleepTimeRecords(user, '2026-05-01')).toEqual({
        latest: null,
        latest_with_optimal: null,
      })
    })
  })

  describe('getLatestOuraPersonalInfo', () => {
    test('the most recently received document with an age', async () => {
      expect(await getLatestOuraPersonalInfo(user)).toBeNull()
      await insertRawRecords(user, [raw('personal_info', 'p1', { age: 44 }, '2026-01-01T00:00:00Z')])
      const info = await getLatestOuraPersonalInfo(user)
      expect(info?.age).toBe(44)
      expect(info?.received_at).toBeInstanceOf(Date)
    })
  })

  describe('getOuraTagOccurrences', () => {
    test('Oura tag activities with their display name; unknown, deleted and untagged rows excluded', async () => {
      await sql(
        `INSERT INTO activity_type_definitions (name, display_name) VALUES
           ('tag_sleep_alcohol', 'Alcohol drinks'), ('sleeping_alone', 'sleeping_alone'), ('unknown', 'Unknown')
         ON CONFLICT (name) DO NOTHING`,
      )
      await insertActivity('oura', 'tag_sleep_alcohol', '2026-06-01T19:00:00Z', null, {
        tag_key: 'tag_sleep_alcohol',
      })
      await insertActivity('oura', 'sleeping_alone', '2026-06-02T19:00:00Z', null, { tag_key: 'custom' })
      await insertActivity('oura', 'unknown', '2026-06-02T19:00:00Z', null, { tag_key: 'custom' })
      await insertActivity('oura', 'tag_sleep_alcohol', '2026-06-03T19:00:00Z', null, { tag_key: 'x' }, true)
      await insertActivity('oura', 'meditation', '2026-06-03T19:00:00Z', null, {})
      await insertActivity('garmin', 'tag_sleep_alcohol', '2026-06-03T19:00:00Z', null, { tag_key: 'x' })

      const rows = await getOuraTagOccurrences(
        user,
        new Date('2026-06-01T00:00:00Z'),
        new Date('2026-06-10T00:00:00Z'),
      )
      expect(rows.map((r) => [r.activity_type, r.display_name])).toEqual([
        ['tag_sleep_alcohol', 'Alcohol drinks'],
        ['sleeping_alone', 'sleeping_alone'],
      ])
    })
  })

  describe('daily_activity backfill reads', () => {
    test('pages by (recorded_at, id) and counts documents against stamped contributor times', async () => {
      await insertRawRecords(
        user,
        Array.from({ length: 5 }, (_, i) =>
          raw(
            'daily_activity',
            `da${i}`,
            {
              contributors: i === 4 ? { stay_active: null } : { stay_active: 80 + i },
              day: `2026-06-0${i + 1}`,
              timestamp: `2026-06-0${i + 1}T04:00:00+02:00`,
            },
            `2026-06-0${i + 1}T02:00:00Z`,
          ),
        ),
      )
      const first = await getOuraDailyActivityPage(user, null, 2)
      const second = await getOuraDailyActivityPage(user, first.at(-1)!, 2)
      const third = await getOuraDailyActivityPage(user, second.at(-1)!, 2)
      expect([...first, ...second, ...third].map((r) => r.data.day)).toEqual([
        '2026-06-01',
        '2026-06-02',
        '2026-06-03',
        '2026-06-04',
        '2026-06-05',
      ])
      expect(third).toHaveLength(1)

      const metrics = ['activity_stay_active']
      expect(await getOuraDerivedBackfillCounts(user, metrics)).toEqual({ documents: 4, stamped: 0 })
      await insertTimeSeries(user, [
        { metric: 'activity_stay_active', source: 'oura', time: new Date('2026-06-01T02:00:00Z'), value: 80 },
      ])
      expect(await getOuraDerivedBackfillCounts(user, metrics)).toEqual({ documents: 4, stamped: 1 })
    })
  })
})
