import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import { processOuraData } from './process.ts'

vi.mock('../../db/index.ts', () => ({
  insertActivity: vi.fn().mockResolvedValue('activity-id'),
  insertRawRecord: vi.fn().mockResolvedValue(undefined),
  insertTimeSeries: vi.fn().mockResolvedValue(undefined),
  resolveOrCreateActivityType: vi.fn().mockResolvedValue('exercise'),
}))

const metricValues = () =>
  vi
    .mocked(db.insertTimeSeries)
    .mock.calls.flatMap(([, points]) => points.map((point) => [point.metric, point.value] as const))

describe('extended Oura processors', () => {
  beforeEach(() => vi.clearAllMocks())

  test('persists daily activity totals, targets, and movement metrics', async () => {
    await processOuraData('ky_home', 'dailyActivity', [
      {
        active_calories: 640,
        average_met_minutes: 1.5,
        day: '2026-10-18',
        equivalent_walking_distance: 9200,
        high_activity_time: 1800,
        id: 'activity-2026-10-18',
        inactivity_alerts: 2,
        meters_to_target: 800,
        score: 84,
        sedentary_time: 31_000,
        steps: 11_234,
        target_calories: 550,
        target_meters: 10_000,
        total_calories: 2_490,
      },
    ])

    expect(metricValues()).toEqual(
      expect.arrayContaining([
        ['activity_score', 84],
        ['steps', 11_234],
        ['activity_calories_active', 640],
        ['activity_calories_total', 2_490],
        ['activity_target_calories', 550],
        ['activity_target_meters', 10_000],
        ['equivalent_walking_distance', 9200],
        ['high_activity_time_sec', 1800],
        ['inactivity_alerts', 2],
        ['meters_to_target', 800],
        ['sedentary_time_sec', 31_000],
      ]),
    )
    expect(db.insertRawRecord).toHaveBeenCalledWith(
      'ky_home',
      expect.objectContaining({ external_id: 'activity-2026-10-18', record_type: 'daily_activity' }),
    )
  })

  test('persists stress, recovery, SpO2, and breathing disturbance', async () => {
    await processOuraData('ky_home', 'dailyStress', [
      { day: '2026-10-18', id: 'stress-1', recovery_high: 7_200, stress_high: 5_400 },
    ])
    await processOuraData('ky_home', 'dailySpo2', [
      {
        breathing_disturbance_index: 3.2,
        day: '2026-10-18',
        id: 'spo2-1',
        spo2_percentage: { average: 96.8 },
      },
    ])

    expect(metricValues()).toEqual(
      expect.arrayContaining([
        ['stress_high_sec', 5_400],
        ['recovery_high_sec', 7_200],
        ['spo2', 96.8],
        ['breathing_disturbance_index', 3.2],
      ]),
    )
  })

  test('persists timestamped heart-rate samples without collapsing them', async () => {
    await processOuraData('ky_home', 'heartRate', [
      { bpm: 61, source: 'awake', timestamp: '2026-10-18T08:00:00+02:00' },
      { bpm: 65, source: 'awake', timestamp: '2026-10-18T08:00:05+02:00' },
    ])

    expect(db.insertTimeSeries).toHaveBeenCalledWith(
      'ky_home',
      expect.arrayContaining([
        expect.objectContaining({ metric: 'heart_rate', source: 'oura', value: 61 }),
        expect.objectContaining({ metric: 'heart_rate', source: 'oura', value: 65 }),
      ]),
    )
    expect(db.insertRawRecord).toHaveBeenCalledTimes(1)
    expect(db.insertRawRecord).toHaveBeenCalledWith(
      'ky_home',
      expect.objectContaining({
        data: expect.objectContaining({
          day: '2026-10-18',
          samples: expect.arrayContaining([
            expect.objectContaining({ bpm: 61 }),
            expect.objectContaining({ bpm: 65 }),
          ]),
        }),
        external_id: '2026-10-18',
        record_type: 'heartrate',
      }),
    )
  })

  test('upserts workouts by stable Oura external id', async () => {
    const workout = {
      activity: 'running',
      calories: 500,
      distance: 10_000,
      end_datetime: '2026-10-18T10:00:00+02:00',
      id: 'workout-1',
      start_datetime: '2026-10-18T09:00:00+02:00',
    }
    await processOuraData('ky_home', 'workouts', [workout])
    await processOuraData('ky_home', 'workouts', [workout])

    expect(db.insertActivity).toHaveBeenCalledTimes(2)
    expect(db.insertActivity).toHaveBeenLastCalledWith(
      'ky_home',
      expect.objectContaining({ activity_type: 'exercise', external_id: 'workout-1', source: 'oura' }),
    )
  })

  test('deduplicates identical workouts with different Oura ids while preserving both raw records', async () => {
    const workout = {
      activity: 'walking',
      calories: 42,
      distance: 906,
      end_datetime: '2026-08-16T10:45:00+02:00',
      intensity: 'moderate',
      label: null,
      source: 'confirmed',
      start_datetime: '2026-08-16T10:32:00+02:00',
    }

    await processOuraData('ky_home', 'workouts', [
      { ...workout, id: 'workout-b' },
      { ...workout, id: 'workout-a' },
    ])

    expect(db.insertRawRecord).toHaveBeenCalledTimes(2)
    expect(db.insertActivity).toHaveBeenCalledTimes(1)
    expect(db.insertActivity).toHaveBeenCalledWith(
      'ky_home',
      expect.objectContaining({ external_id: 'workout-a' }),
    )
  })

  test('preserves ring configuration as raw device data', async () => {
    await processOuraData('ky_home', 'ringConfiguration', [
      { color: 'silver', firmware_version: '3.0.1', id: 'ring-1', model: 'gen4', size: 10 },
    ])

    expect(db.insertRawRecord).toHaveBeenCalledWith(
      'ky_home',
      expect.objectContaining({ external_id: 'ring-1', record_type: 'ring_configuration' }),
    )
  })
})
