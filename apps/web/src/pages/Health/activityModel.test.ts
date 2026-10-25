import type { GoalProgress, HealthDailyPoint, WorkoutSummary } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  cumulativeMinutesByType,
  dailyTargetProgress,
  intensityCountsText,
  stepsGoalPerDay,
  stepsSummaryText,
  targetProgressByDay,
  windowDays,
  workoutTotals,
} from './activityModel'

const pt = (date: string, value: number): HealthDailyPoint => ({ baseline: null, date, value })

describe('dailyTargetProgress', () => {
  it('is 1 − left / target, clamped, and met at or below zero left', () => {
    expect(dailyTargetProgress(2000, 8000)).toEqual({ met: false, progress: 0.75 })
    expect(dailyTargetProgress(0, 8000)).toEqual({ met: true, progress: 1 })
    expect(dailyTargetProgress(-1500, 8000)).toEqual({ met: true, progress: 1 })
    expect(dailyTargetProgress(9000, 8000)).toEqual({ met: false, progress: 0 })
  })

  it('is null without a usable target', () => {
    expect(dailyTargetProgress(100, 0)).toBeNull()
    expect(dailyTargetProgress(Number.NaN, 8000)).toBeNull()
  })
})

describe('targetProgressByDay and stepsSummaryText', () => {
  const left = [pt('2026-10-01', 0), pt('2026-10-02', 4000), pt('2026-10-03', 100)]
  const target = [pt('2026-10-01', 8000), pt('2026-10-02', 8000)]

  it('only keeps days with both values', () => {
    const byDay = targetProgressByDay(left, target)
    expect([...byDay.keys()]).toEqual(['2026-10-01', '2026-10-02'])
    expect(byDay.get('2026-10-02')).toEqual({ met: false, progress: 0.5 })
  })

  it('summarises average steps and met days', () => {
    const byDay = targetProgressByDay(left, target)
    expect(stepsSummaryText([pt('2026-10-01', 8000), pt('2026-10-02', 9280)], byDay)).toBe(
      'Avg 8,640 steps · target met on 1 of 2 days',
    )
    expect(stepsSummaryText([], new Map())).toBeNull()
  })
})

describe('steps goal', () => {
  const goal = (window: string, extra: Partial<GoalProgress> = {}): GoalProgress =>
    ({
      current: 0,
      goal_type: 'metric',
      id: '00000000-0000-4000-8000-000000000000',
      losing_tomorrow: 0,
      metric: 'steps',
      min: 70000,
      unit: 'count',
      window,
      ...extra,
    }) as GoalProgress

  it('parses goal windows in days', () => {
    expect(windowDays('7d')).toBe(7)
    expect(windowDays('2w')).toBe(14)
    expect(windowDays('1M')).toBe(30)
    expect(windowDays('12h')).toBeNull()
    expect(windowDays('x')).toBeNull()
  })

  it('spreads a steps minimum over its window', () => {
    expect(stepsGoalPerDay([goal('7d')])).toBe(10000)
    expect(stepsGoalPerDay([goal('1d', { min: 8000 })])).toBe(8000)
  })

  it('ignores other metrics, max-only goals and missing goals', () => {
    expect(stepsGoalPerDay(undefined)).toBeNull()
    expect(stepsGoalPerDay([goal('7d', { metric: 'hr_zone_2_sec' } as Partial<GoalProgress>)])).toBeNull()
    expect(stepsGoalPerDay([goal('7d', { max: 5, min: undefined })])).toBeNull()
  })
})

describe('workoutTotals', () => {
  const w = (extra: Partial<WorkoutSummary>): WorkoutSummary =>
    ({
      activity_type: 'running',
      color: '#000',
      display_name: 'Run',
      exercise_count: 0,
      id: 'x',
      member_ids: [],
      set_count: 0,
      sets_status: 'not_applicable',
      sources: ['oura'],
      start_time: '2026-10-01T08:00:00Z',
      volume_kg: 0,
      ...extra,
    }) as WorkoutSummary

  it('counts intensities, duration, calories and strength work', () => {
    const totals = workoutTotals([
      w({ calories: 300, duration_min: 30, intensity: 'hard' }),
      w({ calories: 200, duration_min: 45, intensity: 'moderate' }),
      w({ duration_min: 50, set_count: 12, sets_status: 'logged', volume_kg: 4200 }),
      w({ duration_min: 40, sets_status: 'not_logged' }),
    ])
    expect(totals.count).toBe(4)
    expect(totals.durationMin).toBe(165)
    expect(totals.calories).toBe(500)
    expect(totals.byIntensity).toEqual({ easy: 0, hard: 1, moderate: 1, unlabelled: 2 })
    expect(totals.strength).toEqual({ logged: 1, sessions: 2, sets: 12, volumeKg: 4200 })
    expect(intensityCountsText(totals.byIntensity)).toBe('1 hard · 1 moderate')
    expect(intensityCountsText({ easy: 0, hard: 0, moderate: 0, unlabelled: 3 })).toBeNull()
  })
})

describe('cumulativeMinutesByType', () => {
  const w = (activity_type: string, start_time: string, duration_min: number): WorkoutSummary =>
    ({
      activity_type,
      color: '#000',
      display_name: activity_type.charAt(0).toUpperCase() + activity_type.slice(1),
      duration_min,
      exercise_count: 0,
      id: `${activity_type}-${start_time}`,
      member_ids: [],
      set_count: 0,
      sets_status: 'not_applicable',
      sources: ['oura'],
      start_time,
      volume_kg: 0,
    }) as WorkoutSummary
  const days = ['2026-10-01', '2026-10-02', '2026-10-03']
  const dayOf = (iso: string) => iso.slice(0, 10)

  it('keeps a running total per type, most-trained first, one point per day', () => {
    const series = cumulativeMinutesByType(
      [
        w('walking', '2026-10-01T08:00:00Z', 20),
        w('walking', '2026-10-03T08:00:00Z', 10),
        w('running', '2026-10-02T08:00:00Z', 45),
        w('running', '2026-09-30T08:00:00Z', 99),
      ],
      days,
      dayOf,
    )
    expect(series.map((s) => s.key)).toEqual(['running', 'walking'])
    expect(series[0]!.points.map((p) => p.value)).toEqual([0, 2700, 2700])
    expect(series[1]!.points.map((p) => p.value)).toEqual([1200, 1200, 1800])
    expect(series[1]!.totalSec).toBe(1800)
  })

  it('folds types beyond the top N into Other', () => {
    const series = cumulativeMinutesByType(
      [
        w('a', '2026-10-01T08:00:00Z', 30),
        w('b', '2026-10-01T08:00:00Z', 20),
        w('c', '2026-10-02T08:00:00Z', 10),
      ],
      days,
      dayOf,
      1,
    )
    expect(series.map((s) => s.label)).toEqual(['A', 'Other'])
    expect(series[1]!.points.map((p) => p.value)).toEqual([1200, 1800, 1800])
  })
})
