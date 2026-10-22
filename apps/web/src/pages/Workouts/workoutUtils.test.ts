import type { WorkoutSummary } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  calendarMonths,
  groupByDay,
  logState,
  markLabel,
  markStyle,
  strengthLogCounts,
  trainingDaysPerWeek,
  weekStartOf,
  weeklyByType,
  weeksBetween,
  zoneTotals,
} from './workoutUtils'

const w = (over: Partial<WorkoutSummary>): WorkoutSummary => ({
  activity_type: 'walking',
  color: '#8b5cf6',
  display_name: 'Walking',
  exercise_count: 0,
  id: Math.random().toString(),
  member_ids: [],
  set_count: 0,
  sets_status: 'not_applicable',
  sources: ['oura'],
  start_time: new Date(2026, 9, 20, 12, 0).toISOString(),
  volume_kg: 0,
  ...over,
})

describe('workout calendar helpers', () => {
  it('starts weeks on Monday', () => {
    expect(weekStartOf('2026-10-22')).toBe('2026-10-19')
    expect(weekStartOf('2026-10-19')).toBe('2026-10-19')
    expect(weekStartOf('2026-10-25')).toBe('2026-10-19')
  })

  it('lays a month out in Monday-first weeks', () => {
    const [oct] = calendarMonths('2026-10-05', '2026-10-20')
    expect(oct!.weeks[0]!.slice(0, 4)).toEqual([null, null, null, '2026-10-01'])
    expect(oct!.weeks.flat().filter(Boolean)).toHaveLength(31)
    expect(calendarMonths('2026-09-25', '2026-10-20').map((m) => m.key)).toEqual(['2026-8', '2026-9'])
  })

  it('keeps several workouts on one day', () => {
    const byDay = groupByDay([w({}), w({ activity_type: 'wrestling' })])
    expect(byDay.get('2026-10-20')).toHaveLength(2)
  })

  it('aggregates per week and type, and counts training days once', () => {
    const list = [
      w({ duration_min: 30 }),
      w({ duration_min: 20, start_time: new Date(2026, 9, 20, 18).toISOString() }),
      w({
        activity_type: 'strength_training',
        display_name: 'Strength',
        duration_min: 60,
        start_time: new Date(2026, 9, 22, 18).toISOString(),
      }),
    ]
    const minutes = weeklyByType(list, (x) => x.duration_min ?? 0)
    expect(minutes.map((s) => [s.type.type, s.values.get('2026-10-19')])).toEqual([
      ['walking', 50],
      ['strength_training', 60],
    ])
    expect(trainingDaysPerWeek(list).get('2026-10-19')).toBe(2)
    expect(weeksBetween('2026-10-01', '2026-10-20')).toEqual([
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ])
  })

  it('sums zone time only over workouts with zone data', () => {
    const z = { 0: 60, 1: 60, 2: 120, 3: 0, 4: 0, 5: 0 }
    expect(zoneTotals([w({ zone_secs: z }), w({}), w({ zone_secs: z })])).toEqual({
      covered: 2,
      secs: [120, 120, 240, 0, 0, 0],
    })
  })
})

describe('strength log state', () => {
  it('tells logged strength sessions from synced ones with no sets', () => {
    const logged = w({
      activity_type: 'strength_training',
      set_count: 8,
      sets_status: 'logged',
      sources: ['hermes', 'oura'],
    })
    const ouraOnly = w({ activity_type: 'strength_training', sets_status: 'not_logged', sources: ['oura'] })
    const walk = w({})
    expect([logged, ouraOnly, walk].map(logState)).toEqual(['logged', 'unlogged', 'none'])
    expect(markStyle(ouraOnly)).toEqual({ background: 'transparent', boxShadow: 'inset 0 0 0 2px #8b5cf6' })
    expect(markStyle(logged)).toEqual({ background: '#8b5cf6' })
    expect(markLabel(ouraOnly)).toBe('Walking — sets not logged (Oura only)')
    expect(markLabel(logged)).toBe('Walking — 8 sets logged')
    expect(strengthLogCounts([logged, ouraOnly, walk])).toEqual({ logged: 1, unlogged: 1 })
  })
})
