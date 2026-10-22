import { describe, expect, it } from 'vitest'

import { buildExerciseIndex, resolveExercise } from './exercise-catalog.ts'
import { localDateOf, parseStrengthText, shiftDate } from './strength-parse.ts'

const index = buildExerciseIndex()
const now = new Date('2026-10-22T17:30:00Z')
const parse = (text: string) => parseStrengthText(text, { index, now, tz: 'Europe/Ljubljana' })

describe('resolveExercise', () => {
  it.each(['bench', 'Bench Press', 'barbell bench press', 'BB bench press', 'flat bench'])(
    'resolves %s to the barbell bench press',
    (name) => expect(resolveExercise(name, index).key).toBe('bench_press'),
  )

  it('keeps dumbbell and incline bench variants apart', () => {
    expect(resolveExercise('db bench', index).key).toBe('dumbbell_bench_press')
    expect(resolveExercise('dumbbell bench press', index).key).toBe('dumbbell_bench_press')
    expect(resolveExercise('incline bench', index).key).toBe('incline_bench_press')
    expect(resolveExercise('incline dumbbell press', index).key).toBe('incline_dumbbell_press')
  })

  it('reduces plurals', () => {
    expect(resolveExercise('pullups', index).key).toBe('pull_up')
    expect(resolveExercise('dumbbell curls', index).key).toBe('dumbbell_curl')
    expect(resolveExercise('squats', index).key).toBe('squat')
  })

  it('gives an unknown name its own stable key instead of guessing a lift', () => {
    const r = resolveExercise('Zercher Squats', index)
    expect(r).toMatchObject({ key: 'zercher_squat', known: false, name: 'Zercher Squat' })
    expect(resolveExercise('curls', index).known).toBe(false)
  })

  it('lets a user-defined alias win over a built-in one', () => {
    const custom = buildExerciseIndex([
      { aliases: ['bench'], builtin: false, is_bodyweight: false, key: 'spoto_press', name: 'Spoto Press' },
    ])
    expect(resolveExercise('bench', custom).key).toBe('spoto_press')
  })
})

describe('parseStrengthText', () => {
  it('reads sets×reps with a weight', () => {
    const r = parse('bench press 5x5 50kg')
    expect(r.unparsed).toEqual([])
    expect(r.exercises).toHaveLength(1)
    expect(r.exercises[0]).toMatchObject({
      exercise: 'Bench Press',
      exercise_key: 'bench_press',
      known: true,
    })
    expect(r.exercises[0]!.sets).toHaveLength(5)
    expect(r.exercises[0]!.sets[0]).toEqual({ reps: 5, weight: 50, weight_unit: 'kg' })
  })

  it('reads several exercises and the day', () => {
    const r = parse('Today bench 5x5 50kg, squat 3x8 70kg, deadlift 3x5 90kg')
    expect(r.date).toBe('2026-10-22')
    expect(
      r.exercises.map((e) => [e.exercise_key, e.sets.length, e.sets[0]!.reps, e.sets[0]!.weight]),
    ).toEqual([
      ['bench_press', 5, 5, 50],
      ['squat', 3, 8, 70],
      ['deadlift', 3, 5, 90],
    ])
  })

  it('reads "N sets of R" for a bodyweight movement as zero external load', () => {
    const r = parse('Yesterday did 4 sets of 10 pullups')
    expect(r.date).toBe('2026-10-21')
    expect(r.exercises[0]!.exercise_key).toBe('pull_up')
    expect(r.exercises[0]!.sets).toHaveLength(4)
    expect(r.exercises[0]!.sets[0]).toEqual({ bodyweight: true, reps: 10, weight: 0 })
  })

  it('reads a weight×reps pyramid continued across commas', () => {
    const r = parse('Squat 60x10, 70x8, 80x6')
    expect(r.exercises).toHaveLength(1)
    expect(r.exercises[0]!.sets.map((s) => [s.weight, s.reps])).toEqual([
      [60, 10],
      [70, 8],
      [80, 6],
    ])
  })

  it('reads the weight and name after the sets', () => {
    const r = parse("Add 3x12 15kg dumbbell curls to today's workout")
    expect(r.date).toBe('2026-10-22')
    expect(r.exercises[0]!.exercise_key).toBe('dumbbell_curl')
    expect(r.exercises[0]!.sets).toHaveLength(3)
    expect(r.exercises[0]!.sets[0]).toEqual({ reps: 12, weight: 15, weight_unit: 'kg' })
    expect(r.unparsed).toEqual([])
  })

  it('does not invent a weight that was not given', () => {
    const r = parse('bench 3x8')
    expect(r.exercises[0]!.sets[0]).toEqual({ reps: 8 })
  })

  it('keeps pounds for conversion and reads decimal commas', () => {
    expect(parse('bench 3x5 135lbs').exercises[0]!.sets[0]).toEqual({
      reps: 5,
      weight: 135,
      weight_unit: 'lb',
    })
    expect(parse('bench 3x5 52,5kg').exercises[0]!.sets[0]).toEqual({
      reps: 5,
      weight: 52.5,
      weight_unit: 'kg',
    })
  })

  it('reads added weight on a bodyweight movement', () => {
    expect(parse('dips 3x8 +10kg').exercises[0]!.sets[0]).toEqual({
      bodyweight: true,
      reps: 8,
      weight: 10,
      weight_unit: 'kg',
    })
  })

  it('reads timed sets', () => {
    const r = parse('plank 3x60s')
    expect(r.exercises[0]!.sets).toHaveLength(3)
    expect(r.exercises[0]!.sets[0]).toEqual({ bodyweight: true, time: 60, weight: 0 })
    expect(parse('plank 2x1min').exercises[0]!.sets[0]!.time).toBe(60)
  })

  it('reads a weight given before the reps', () => {
    expect(parse('bench 100kg x 3').exercises[0]!.sets).toEqual([{ reps: 3, weight: 100, weight_unit: 'kg' }])
  })

  it('reads set kind, RPE and an explicit time', () => {
    const r = parse('warmup bench 2x10 40kg at 18:15')
    expect(r.time).toBe('18:15')
    expect(r.exercises[0]!.sets[0]).toEqual({ reps: 10, set_type: 'warmup', weight: 40, weight_unit: 'kg' })
    expect(parse('squat 3x5 100kg rpe 8').exercises[0]!.sets[0]!.rpe).toBe(8)
    expect(parse('bench at 6pm 3x5 60kg').time).toBe('18:00')
  })

  it('returns text it cannot read as sets', () => {
    const r = parse('felt great, bench 5x5 50kg')
    expect(r.exercises).toHaveLength(1)
    expect(r.unparsed).toEqual(['felt great'])
  })

  it('reads sets×reps×weight triples', () => {
    expect(parse('deadlift 3x5x100').exercises[0]!.sets).toHaveLength(3)
  })
})

describe('local dates', () => {
  it('attributes a late-evening UTC instant to the Ljubljana day', () => {
    expect(localDateOf(new Date('2026-10-22T22:30:00Z'), 'Europe/Ljubljana')).toBe('2026-10-23')
  })

  it('shifts across the DST change without skipping a day', () => {
    expect(shiftDate('2026-10-26', -1)).toBe('2026-10-25')
    expect(shiftDate('2026-03-29', 1)).toBe('2026-03-30')
  })
})
