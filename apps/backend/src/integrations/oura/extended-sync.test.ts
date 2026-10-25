import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import { processOuraData } from './process.ts'

vi.mock('../../db/index.ts', () => ({
  getActivityTypeDefinitions: vi
    .fn()
    .mockResolvedValue([{ name: 'running' }, { name: 'walking' }, { name: 'strength_training' }]),
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

  test('persists the six activity-score contributors, skipping nulls and unknown keys', async () => {
    await processOuraData('ky_home', 'dailyActivity', [
      {
        contributors: {
          meet_daily_targets: 60,
          move_every_hour: 100,
          recovery_time: 97,
          stay_active: 78,
          training_frequency: null,
          training_volume: 100,
          unknown_future_key: 5,
        },
        day: '2026-10-24',
        id: 'activity-2026-10-24',
        score: 86,
      },
    ])

    const values = metricValues()
    expect(values).toEqual(
      expect.arrayContaining([
        ['activity_meet_daily_targets', 60],
        ['activity_move_every_hour', 100],
        ['activity_recovery_time', 97],
        ['activity_stay_active', 78],
        ['activity_training_volume', 100],
      ]),
    )
    expect(values.map(([metric]) => metric)).not.toContain('activity_training_frequency')
    expect(values.map(([metric]) => metric)).not.toContain('unknown_future_key')
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
      expect.objectContaining({
        activity_type: 'running',
        external_id: 'workout-1',
        source: 'oura',
        title: 'Running',
      }),
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

  test('stores sleep HRV from the `hrv` sample field at the sample timestamp, plus nightly totals', async () => {
    await processOuraData('ky_home', 'sleep', [
      {
        average_breath: 14.5,
        average_heart_rate: 55.2,
        average_hrv: 42,
        awake_time: 1_800,
        bedtime_end: '2026-10-19T07:00:00+02:00',
        bedtime_start: '2026-10-18T23:00:00+02:00',
        day: '2026-10-19',
        deep_sleep_duration: 4_200,
        efficiency: 88,
        heart_rate: null,
        hrv: { interval: 300, items: [null, 40, 44], timestamp: '2026-10-18T23:05:00+02:00' },
        id: 'sleep-1',
        latency: 600,
        light_sleep_duration: 13_000,
        lowest_heart_rate: 48,
        readiness_score_delta: null,
        rem_sleep_duration: 6_000,
        restless_periods: 120,
        sleep_phase_5_min: null,
        time_in_bed: 28_800,
        total_sleep_duration: 23_200,
        type: 'long_sleep',
      },
    ])

    const points = vi.mocked(db.insertTimeSeries).mock.calls.flatMap(([, p]) => p)
    const hrv = points.filter((point) => point.metric === 'hrv_rmssd')
    expect(hrv.map((point) => [point.time.toISOString(), point.value])).toEqual([
      ['2026-10-18T21:10:00.000Z', 40],
      ['2026-10-18T21:15:00.000Z', 44],
    ])
    expect(metricValues()).toEqual(
      expect.arrayContaining([
        ['sleep_duration_sec', 23_200],
        ['sleep_deep_sec', 4_200],
        ['sleep_rem_sec', 6_000],
        ['sleep_light_sec', 13_000],
        ['sleep_awake_sec', 1_800],
        ['time_in_bed_sec', 28_800],
        ['sleep_efficiency_percent', 88],
        ['sleep_latency_sec', 600],
        ['respiratory_rate', 14.5],
        ['sleep_average_heart_rate', 55.2],
        ['sleep_restless_periods', 120],
      ]),
    )
  })

  test('persists day-only resilience, cardiovascular age, readiness detail, VO2 max and stress summary', async () => {
    await processOuraData('ky_home', 'dailyResilience', [
      {
        contributors: { daytime_recovery: 30.5, sleep_recovery: 70.1, stress: 45 },
        day: '2026-10-18',
        id: 'res-1',
        level: 'adequate',
      },
    ])
    await processOuraData('ky_home', 'dailyCardiovascularAge', [
      { day: '2026-10-18', id: 'cva-1', pulse_wave_velocity: 6.8, vascular_age: 33 },
    ])
    await processOuraData('ky_home', 'dailyReadiness', [
      {
        contributors: { hrv_balance: 77, sleep_regularity: null },
        day: '2026-10-18',
        id: 'ready-1',
        score: 81,
        temperature_deviation: -0.12,
        temperature_trend_deviation: 0.05,
        timestamp: '2026-10-18T00:00:00+02:00',
      },
    ])
    await processOuraData('ky_home', 'vo2Max', [{ day: '2026-10-18', id: 'vo2-1', vo2_max: 44 }])
    await processOuraData('ky_home', 'dailyStress', [
      { day: '2026-10-18', day_summary: 'stressful', id: 'stress-2', recovery_high: 0, stress_high: 9_000 },
    ])

    const values = metricValues()
    expect(values).toEqual(
      expect.arrayContaining([
        ['resilience_score', 40],
        ['resilience_sleep_recovery', 70.1],
        ['resilience_daytime_recovery', 30.5],
        ['resilience_stress', 45],
        ['cardiovascular_age', 33],
        ['pulse_wave_velocity', 6.8],
        ['readiness_score', 81],
        ['readiness_hrv_balance', 77],
        ['temperature_deviation', -0.12],
        ['temperature_trend_deviation', 0.05],
        ['vo2_max', 44],
        ['stress_day_summary', 3],
      ]),
    )
    expect(values.map(([metric]) => metric)).not.toContain('readiness_sleep_regularity')
  })

  test('stores ring battery levels and raw-only documents', async () => {
    await processOuraData('ky_home', 'ringBatteryLevel', [
      { charging: false, level: 80, timestamp: '2026-10-18T06:00:00Z' },
      { charging: true, level: 85, timestamp: '2026-10-18T06:30:00Z' },
    ])
    await processOuraData('ky_home', 'sleepTime', [
      { day: '2026-10-18', id: 'st-1', recommendation: 'follow_optimal_bedtime', status: 'optimal_found' },
    ])
    await processOuraData('ky_home', 'restModePeriods', [
      {
        end_day: null,
        episodes: [],
        id: 'rm-1',
        start_day: '2026-10-10',
        start_time: '2026-10-10T09:00:00+02:00',
      },
    ])

    expect(metricValues()).toEqual([
      ['ring_battery_level', 80],
      ['ring_battery_level', 85],
    ])
    for (const [externalId, recordType] of [
      ['2026-10-18', 'ring_battery_level'],
      ['st-1', 'sleep_time'],
      ['rm-1', 'rest_mode_period'],
    ]) {
      expect(db.insertRawRecord).toHaveBeenCalledWith(
        'ky_home',
        expect.objectContaining({ external_id: externalId, record_type: recordType }),
      )
    }
  })
})
