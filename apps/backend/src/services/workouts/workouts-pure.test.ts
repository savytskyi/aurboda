import type { StrengthSet } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import type { Activity } from '../../db/types.ts'

import { mergeOverlappingActivities } from '../../db/activities/merge.ts'
import { humanizeOuraActivity, ouraWorkoutActivityType } from '../../integrations/oura/workout-types.ts'
import { rankCandidates, scoreMatch, AUTO_LINK_CONFIDENCE } from './matching.ts'
import { appendSets, formatWorkoutReply, resolveEntryTime, workoutIntensity } from './service.ts'
import {
  buildProgress,
  estimatedOneRepMax,
  formatExerciseSets,
  formatWorkoutSets,
  setVolume,
  summarizeExercises,
  totalVolume,
} from './strength-math.ts'

const set = (over: Partial<StrengthSet>): StrengthSet => ({
  distance: null,
  exercise: 'Bench Press',
  exercise_key: 'bench_press',
  order: 1,
  reps: 5,
  rpe: null,
  set_type: 'normal',
  time: null,
  weight: 50,
  ...over,
})

const t = (iso: string) => new Date(iso)

describe('volume and estimated 1RM', () => {
  it('sums weight × reps over logged sets only', () => {
    const sets = [
      ...Array.from({ length: 5 }, (_, i) => set({ order: i + 1 })),
      ...Array.from({ length: 3 }, (_, i) =>
        set({ exercise: 'Squat', exercise_key: 'squat', order: i + 1, reps: 8, weight: 70 }),
      ),
    ]
    expect(totalVolume(sets)).toBe(2930)
  })

  it('counts neither warm-ups nor sets missing a weight or reps', () => {
    expect(setVolume(set({ set_type: 'warmup' }))).toBe(0)
    expect(setVolume(set({ weight: null }))).toBe(0)
    expect(setVolume(set({ reps: null, time: 60 }))).toBe(0)
    expect(setVolume(set({ bodyweight: true, weight: 0 }))).toBe(0)
  })

  it('uses Epley within the working rep range only', () => {
    expect(estimatedOneRepMax(set({ reps: 5, weight: 100 }))).toBe(116.7)
    expect(estimatedOneRepMax(set({ reps: 1, weight: 120 }))).toBe(120)
    expect(estimatedOneRepMax(set({ reps: 15, weight: 60 }))).toBeUndefined()
    expect(estimatedOneRepMax(set({ reps: 5, set_type: 'warmup' }))).toBeUndefined()
    expect(estimatedOneRepMax(set({ weight: 0 }))).toBeUndefined()
  })

  it('summarizes each exercise with its top set', () => {
    const [bench] = summarizeExercises([
      set({ weight: 60 }),
      set({ order: 2, reps: 3, weight: 70 }),
      set({ order: 3, set_type: 'warmup', weight: 80 }),
    ])
    expect(bench).toMatchObject({ set_count: 3, top_set: { reps: 3, weight: 70 }, volume_kg: 510 })
  })
})

describe('reply formatting', () => {
  it('collapses identical sets and lists a pyramid', () => {
    expect(formatExerciseSets(Array.from({ length: 5 }, () => set({})))).toBe('5×5 @ 50 kg')
    expect(
      formatExerciseSets([
        set({ reps: 10, weight: 60 }),
        set({ reps: 8, weight: 70 }),
        set({ reps: 6, weight: 80 }),
      ]),
    ).toBe('10 @ 60 kg, 8 @ 70 kg, 6 @ 80 kg')
    expect(formatExerciseSets([set({ bodyweight: true, reps: 10, weight: 0 })])).toBe('10 (bodyweight)')
    expect(formatExerciseSets([set({ bodyweight: true, reps: 8, weight: 10 })])).toBe('8 @ +10 kg')
  })

  it('formats the Telegram confirmation with the total volume', () => {
    const sets = appendSets(
      [],
      [
        {
          key: 'bench_press',
          name: 'Bench Press',
          sets: Array.from({ length: 5 }, () => ({ reps: 5, weight: 50 })),
        },
        { key: 'squat', name: 'Squat', sets: Array.from({ length: 3 }, () => ({ reps: 8, weight: 70 })) },
      ],
      'hermes',
      t('2026-10-22T17:00:00Z'),
    ).sets
    expect(formatWorkoutSets(sets)).toBe('Bench Press — 5×5 @ 50 kg\nSquat — 3×8 @ 70 kg')
    const text = formatWorkoutReply(
      {
        activity_type: 'strength_training',
        color: '',
        display_name: '',
        exercise_count: 2,
        exercises: [],
        heart_rate: { coverage: 0, overlapping_activity_ids: [], sample_count: 0, status: 'unavailable' },
        id: 'x',
        links: [],
        member_ids: [],
        provenance: {},
        set_count: 8,
        sets,
        sets_status: 'logged',
        sources: ['hermes'],
        sources_detail: [],
        start_time: '2026-10-22T17:00:00Z',
        suggestions: [],
        volume_kg: totalVolume(sets),
      },
      { created: false, now: t('2026-10-22T18:00:00Z'), tz: 'Europe/Ljubljana' },
    )
    expect(text).toBe(
      '✅ Strength workout updated — Today\n\nBench Press — 5×5 @ 50 kg\nSquat — 3×8 @ 70 kg\n\nTotal volume: 2,930 kg',
    )
  })
})

describe('appendSets', () => {
  it('continues set numbering and keeps the exercise position', () => {
    const first = appendSets(
      [],
      [{ key: 'bench_press', name: 'Bench Press', sets: [{ reps: 5, weight: 50 }] }],
      'hermes',
      t('2026-10-22T17:00:00Z'),
    )
    const second = appendSets(
      first.sets,
      [
        { key: 'squat', name: 'Squat', sets: [{ reps: 8, weight: 70 }] },
        { key: 'bench_press', name: 'Bench Press', sets: [{ reps: 5, weight: 55 }] },
      ],
      'hermes',
      t('2026-10-22T17:10:00Z'),
    )
    expect(second.sets.map((s) => [s.exercise_key, s.exercise_order, s.order])).toEqual([
      ['bench_press', 1, 1],
      ['squat', 2, 1],
      ['bench_press', 1, 2],
    ])
    expect(new Set(second.sets.map((s) => s.set_id)).size).toBe(3)
  })

  it('stores pounds as kilograms', () => {
    const { sets } = appendSets(
      [],
      [{ key: 'bench_press', name: 'Bench Press', sets: [{ reps: 5, weight: 135, weight_unit: 'lb' }] }],
      'web',
      t('2026-10-22T17:00:00Z'),
    )
    expect(sets[0]!.weight).toBe(61.235)
  })
})

describe('resolveEntryTime', () => {
  const tz = 'Europe/Ljubljana'
  const now = t('2026-10-22T17:20:00Z')

  it('uses the message time when no time or other day is given', () => {
    expect(resolveEntryTime({}, now, tz)).toEqual({
      local_date: '2026-10-22',
      start: now,
      time_source: 'message_time',
    })
  })

  it('pins a past day without a time to local noon and says so', () => {
    const r = resolveEntryTime({ parsed: { date: '2026-10-21', exercises: [], unparsed: [] } }, now, tz)
    expect(r).toEqual({
      local_date: '2026-10-21',
      start: t('2026-10-21T10:00:00Z'),
      time_source: 'date_only',
    })
  })

  it('reads a local clock time across the DST change', () => {
    const summer = resolveEntryTime(
      { parsed: { date: '2026-10-24', exercises: [], time: '18:00', unparsed: [] } },
      now,
      tz,
    )
    const winter = resolveEntryTime(
      { parsed: { date: '2026-10-26', exercises: [], time: '18:00', unparsed: [] } },
      now,
      tz,
    )
    expect(summer.start.toISOString()).toBe('2026-10-24T16:00:00.000Z')
    expect(winter.start.toISOString()).toBe('2026-10-26T17:00:00.000Z')
    expect(winter.time_source).toBe('explicit')
  })
})

describe('scoreMatch', () => {
  const oura = {
    activity_type: 'strength_training',
    end_time: t('2026-10-22T17:00:00Z'),
    id: 'oura-1',
    local_date: '2026-10-22',
    start_time: t('2026-10-22T16:00:00Z'),
  }

  it('links sets sent shortly after the session', () => {
    const r = scoreMatch(
      { local_date: '2026-10-22', start_time: t('2026-10-22T17:20:00Z'), time_source: 'message_time' },
      oura,
    )
    expect(r.confidence).toBeGreaterThanOrEqual(AUTO_LINK_CONFIDENCE)
  })

  it('links sets sent during the session', () => {
    const r = scoreMatch(
      { local_date: '2026-10-22', start_time: t('2026-10-22T16:30:00Z'), time_source: 'message_time' },
      oura,
    )
    expect(r.confidence).toBe(0.9)
  })

  it('never links on the date alone', () => {
    const dateOnly = scoreMatch(
      { local_date: '2026-10-22', start_time: t('2026-10-22T10:00:00Z'), time_source: 'date_only' },
      oura,
    )
    expect(dateOnly.confidence).toBeLessThan(AUTO_LINK_CONFIDENCE)
    const farApart = scoreMatch(
      { local_date: '2026-10-22', start_time: t('2026-10-22T06:00:00Z'), time_source: 'message_time' },
      oura,
    )
    expect(farApart.confidence).toBeLessThan(0.4)
  })

  it('does not match a different local day or a non-strength session', () => {
    expect(
      scoreMatch(
        { local_date: '2026-10-23', start_time: t('2026-10-22T17:20:00Z'), time_source: 'message_time' },
        oura,
      ).confidence,
    ).toBe(0)
    expect(
      scoreMatch(
        { local_date: '2026-10-22', start_time: t('2026-10-22T16:30:00Z'), time_source: 'message_time' },
        { ...oura, activity_type: 'walking' },
      ).confidence,
    ).toBe(0)
  })

  it('scores explicit times by overlap', () => {
    const r = scoreMatch(
      {
        end_time: t('2026-10-22T17:05:00Z'),
        local_date: '2026-10-22',
        start_time: t('2026-10-22T16:05:00Z'),
        time_source: 'explicit',
      },
      oura,
    )
    expect(r.confidence).toBeGreaterThan(0.9)
  })

  it('leaves two plausible sessions as suggestions only', () => {
    const second = {
      ...oura,
      end_time: t('2026-10-22T18:30:00Z'),
      id: 'oura-2',
      start_time: t('2026-10-22T17:30:00Z'),
    }
    const ranked = rankCandidates(
      { local_date: '2026-10-22', start_time: t('2026-10-22T17:15:00Z'), time_source: 'message_time' },
      [oura, second],
    )
    expect(ranked).toHaveLength(2)
    expect(ranked.every((r) => r.confidence < AUTO_LINK_CONFIDENCE)).toBe(true)
  })

  it('picks the right one of two sessions on the same day', () => {
    const morning = {
      ...oura,
      end_time: t('2026-10-22T07:00:00Z'),
      id: 'morning',
      start_time: t('2026-10-22T06:00:00Z'),
    }
    const ranked = rankCandidates(
      { local_date: '2026-10-22', start_time: t('2026-10-22T17:20:00Z'), time_source: 'message_time' },
      [morning, oura],
    )
    expect(ranked[0]!.candidate.id).toBe('oura-1')
    expect(ranked[0]!.confidence).toBeGreaterThanOrEqual(AUTO_LINK_CONFIDENCE)
  })
})

describe('merge with workout links', () => {
  const categories = new Map([
    ['strength_training', 'exercise'],
    ['walking', 'exercise'],
    ['wrestling', 'exercise'],
    ['exercise', 'exercise'],
  ])
  const oura: Activity = {
    activity_type: 'strength_training',
    data: { calories: 260 },
    end_time: t('2026-10-22T17:00:00Z'),
    id: 'oura',
    source: 'oura',
    start_time: t('2026-10-22T16:00:00Z'),
  }
  const manual: Activity = {
    activity_type: 'strength_training',
    data: { manual_strength: true, sets: [set({})] },
    id: 'manual',
    source: 'aurboda',
    start_time: t('2026-10-22T17:20:00Z'),
  }

  it('keeps a manual workout logged after the session separate until linked', () => {
    expect(mergeOverlappingActivities([oura, manual], categories)).toHaveLength(2)
  })

  it('merges a linked pair into one workout that keeps the sets and the calories', () => {
    const merged = mergeOverlappingActivities(
      [
        { ...oura, linked_ids: ['manual'] },
        { ...manual, linked_ids: ['oura'] },
      ],
      categories,
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]!.id).toBe('manual')
    expect(merged[0]!.data).toMatchObject({ calories: 260, manual_strength: true })
    expect(merged[0]!.source_ids?.sort()).toEqual(['manual', 'oura'])
  })

  it('does not merge overlapping rows the user unlinked', () => {
    const overlapping = {
      ...manual,
      end_time: t('2026-10-22T17:00:00Z'),
      start_time: t('2026-10-22T16:30:00Z'),
    }
    expect(mergeOverlappingActivities([oura, overlapping], categories)).toHaveLength(1)
    expect(
      mergeOverlappingActivities(
        [
          { ...oura, unlinked_ids: ['manual'] },
          { ...overlapping, unlinked_ids: ['oura'] },
        ],
        categories,
      ),
    ).toHaveLength(2)
  })

  it('keeps specific Oura workouts that touch each other apart', () => {
    const walk: Activity = {
      ...oura,
      activity_type: 'walking',
      end_time: t('2026-10-22T16:10:00Z'),
      id: 'walk',
      start_time: t('2026-10-22T15:50:00Z'),
    }
    const wrestling: Activity = { ...oura, activity_type: 'wrestling', id: 'wrestling' }
    expect(mergeOverlappingActivities([walk, wrestling], categories)).toHaveLength(2)
    const generic = [
      { ...walk, activity_type: 'exercise' },
      { ...wrestling, activity_type: 'exercise' },
    ]
    expect(mergeOverlappingActivities(generic, categories)).toHaveLength(1)
  })
})

describe('Oura workout types', () => {
  const known = new Set([
    'strength_training',
    'walking',
    'biking',
    'wrestling',
    'hiking',
    'yard_work',
    'swimming',
    'running',
    'other_workout',
    'soccer',
    'housework',
  ])

  it.each([
    ['strengthTraining', 'strength_training'],
    ['walking', 'walking'],
    ['cycling', 'biking'],
    ['wrestling', 'wrestling'],
    ['yardwork', 'yard_work'],
    ['soccer', 'soccer'],
    ['houseWork', 'housework'],
    ['mountainBiking', 'biking'],
    ['somethingNew', 'other_workout'],
    [null, 'other_workout'],
  ])('maps %s to %s', (activity, type) => expect(ouraWorkoutActivityType(activity, known)).toBe(type))

  it('names unlabelled workouts readably', () => {
    expect(humanizeOuraActivity('strengthTraining')).toBe('Strength Training')
  })
})

describe('buildProgress', () => {
  const tz = 'Europe/Ljubljana'
  const workout = (id: string, iso: string, sets: Partial<StrengthSet>[]) => ({
    sets: sets.map((s, i) => set({ order: i + 1, ...s })),
    start_time: t(iso),
    workout_id: id,
  })

  it('tracks sessions at irregular intervals, weekly totals and separate PRs', () => {
    const p = buildProgress(
      { key: 'bench_press', name: 'Bench Press' },
      [
        workout('w3', '2026-10-20T17:00:00Z', [
          { reps: 3, weight: 70 },
          { reps: 3, weight: 70 },
        ]),
        workout('w1', '2026-09-01T17:00:00Z', [
          { reps: 5, weight: 50 },
          { reps: 5, weight: 50 },
          { reps: 5, weight: 50 },
          { reps: 5, weight: 50 },
          { reps: 5, weight: 50 },
        ]),
        workout('w2', '2026-09-03T17:00:00Z', [
          { reps: 8, weight: 60 },
          { set_type: 'warmup', reps: 10, weight: 80 },
        ]),
        workout('other', '2026-09-02T17:00:00Z', [
          { exercise: 'Squat', exercise_key: 'squat', reps: 5, weight: 200 },
        ]),
      ],
      tz,
    )
    expect(p.sessions.map((s) => s.workout_id)).toEqual(['w1', 'w2', 'w3'])
    expect(p.prs.heaviest_set).toMatchObject({ weight: 70, workout_id: 'w3' })
    expect(p.prs.best_volume_session).toMatchObject({ volume_kg: 1250, workout_id: 'w1' })
    expect(p.prs.best_e1rm).toMatchObject({ e1rm: 77, workout_id: 'w3' })
    expect(p.weekly.map((w) => [w.week_start, w.sessions, w.volume_kg])).toEqual([
      ['2026-08-31', 2, 1730],
      ['2026-10-19', 1, 420],
    ])
    expect(p.rep_bests).toEqual([
      { best_reps: 5, date: '2026-09-01', weight: 50 },
      { best_reps: 8, date: '2026-09-03', weight: 60 },
      { best_reps: 3, date: '2026-10-20', weight: 70 },
    ])
    expect(p.sets).toHaveLength(9)
  })

  it('is empty, not zero, for an exercise never logged', () => {
    const p = buildProgress({ key: 'deadlift', name: 'Deadlift' }, [], tz)
    expect(p.sessions).toEqual([])
    expect(p.prs).toEqual({ best_e1rm: undefined, best_volume_session: undefined, heaviest_set: undefined })
  })
})

describe('workoutIntensity', () => {
  const member = (id: string, intensity?: unknown): Activity => ({
    activity_type: 'running',
    data: intensity === undefined ? {} : { intensity },
    id,
    source: 'oura',
    start_time: t('2026-10-22T16:00:00Z'),
  })

  it("takes the representing row's label", () => {
    expect(workoutIntensity([member('a', 'moderate'), member('b', 'hard')], 'b')).toBe('hard')
  })

  it('falls back to the first member that has one', () => {
    expect(workoutIntensity([member('a'), member('b', 'easy'), member('c', 'hard')], 'a')).toBe('easy')
  })

  it('omits unknown or missing labels', () => {
    expect(workoutIntensity([member('a', 'extreme'), member('b', 3)], 'a')).toBeUndefined()
    expect(workoutIntensity([member('a')], 'a')).toBeUndefined()
  })
})
