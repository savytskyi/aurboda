import type { ExerciseSummary, StrengthProgress, StrengthSet } from '@aurboda/api-spec'

import { localDateOf } from './strength-parse.ts'

/**
 * Epley is an estimate, not a measured max, and degrades with reps: only
 * working sets of at most this many reps feed it.
 */
export const E1RM_MAX_REPS = 12

const round1 = (v: number): number => Math.round(v * 10) / 10

const isWorking = (set: StrengthSet): boolean => set.set_type === 'normal' || set.set_type === 'failure'

/** weight × reps; a set missing either contributes nothing, and warm-ups are not training volume. */
export const setVolume = (set: StrengthSet): number =>
  set.set_type !== 'warmup' && set.weight !== null && set.reps !== null ? set.weight * set.reps : 0

export const totalVolume = (sets: StrengthSet[]): number =>
  round1(sets.reduce((sum, s) => sum + setVolume(s), 0))

/** Epley, w × (1 + r/30); a single is its own max. Undefined for sets the estimate does not apply to. */
export const estimatedOneRepMax = (set: StrengthSet): number | undefined => {
  if (!isWorking(set) || set.weight === null || set.reps === null) return undefined
  if (set.weight <= 0 || set.reps < 1 || set.reps > E1RM_MAX_REPS) return undefined
  return set.reps === 1 ? set.weight : round1(set.weight * (1 + set.reps / 30))
}

const keyOf = (set: StrengthSet): string => set.exercise_key ?? set.exercise

/** The heaviest working set, ties broken by reps. */
const topSet = (sets: StrengthSet[]): StrengthSet | undefined =>
  sets
    .filter((s) => isWorking(s) && s.weight !== null && (s.reps ?? 0) > 0)
    .reduce<StrengthSet | undefined>(
      (best, s) =>
        !best || s.weight! > best.weight! || (s.weight === best.weight && (s.reps ?? 0) > (best.reps ?? 0))
          ? s
          : best,
      undefined,
    )

const maxOf = (values: (number | undefined)[]): number | undefined => {
  const defined = values.filter((v): v is number => v !== undefined)
  return defined.length > 0 ? Math.max(...defined) : undefined
}

/** Per-exercise totals, in the order the exercises were first logged. */
export const summarizeExercises = (sets: StrengthSet[]): ExerciseSummary[] => {
  const groups = new Map<string, StrengthSet[]>()
  for (const set of sets) {
    const group = groups.get(keyOf(set)) ?? []
    group.push(set)
    groups.set(keyOf(set), group)
  }
  return [...groups.entries()].map(([key, group]) => {
    const top = topSet(group)
    return {
      best_e1rm: maxOf(group.map(estimatedOneRepMax)),
      exercise: group[0]!.exercise,
      exercise_key: key,
      reps_total: group.reduce((sum, s) => sum + (s.set_type === 'warmup' ? 0 : (s.reps ?? 0)), 0),
      set_count: group.length,
      top_set: top ? { reps: top.reps, weight: top.weight } : undefined,
      volume_kg: totalVolume(group),
    }
  })
}

export const sortSets = (sets: StrengthSet[]): StrengthSet[] =>
  [...sets].sort((a, b) => (a.exercise_order ?? 0) - (b.exercise_order ?? 0) || a.order - b.order)

const formatKg = (kg: number): string => `${Number.isInteger(kg) ? kg : round1(kg)} kg`

const formatSeconds = (secs: number): string =>
  secs >= 60 && secs % 60 === 0 ? `${secs / 60} min` : `${Math.round(secs)} s`

const setLabel = (set: StrengthSet): string => {
  const load =
    set.bodyweight && (set.weight ?? 0) === 0
      ? ' (bodyweight)'
      : set.weight !== null
        ? ` @ ${set.bodyweight ? '+' : ''}${formatKg(set.weight)}`
        : ''
  const flag = set.set_type === 'warmup' ? ' warm-up' : set.set_type === 'drop_set' ? ' drop' : ''
  if (set.time !== null && set.reps === null) return `${formatSeconds(set.time)}${load}${flag}`
  return `${set.reps ?? '?'}${load}${flag}`
}

/**
 * One exercise's sets as text: identical consecutive sets collapse to
 * `5×5 @ 50 kg`, a pyramid reads `10 @ 60 kg, 8 @ 70 kg`.
 */
export const formatExerciseSets = (sets: StrengthSet[]): string => {
  const runs: { label: string; count: number }[] = []
  for (const set of sets) {
    const label = setLabel(set)
    const last = runs.at(-1)
    if (last && last.label === label) last.count++
    else runs.push({ count: 1, label })
  }
  return runs.map((r) => (r.count > 1 ? `${r.count}×${r.label}` : r.label)).join(', ')
}

export const formatVolume = (kg: number): string =>
  `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(kg)} kg`

/** Telegram-ready summary of a workout's sets. */
export const formatWorkoutSets = (sets: StrengthSet[]): string => {
  const ordered = sortSets(sets)
  const keys = [...new Set(ordered.map(keyOf))]
  return keys
    .map((key) => {
      const group = ordered.filter((s) => keyOf(s) === key)
      return `${group[0]!.exercise} — ${formatExerciseSets(group)}`
    })
    .join('\n')
}

export interface WorkoutSets {
  workout_id: string
  start_time: Date
  sets: StrengthSet[]
}

const mondayOf = (date: string): string => {
  const d = new Date(`${date}T12:00:00Z`)
  const offset = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - offset)
  return d.toISOString().slice(0, 10)
}

/**
 * Progression of one exercise across the given workouts, which need not be
 * evenly spaced: every point is a real session, weeks without one are absent
 * rather than zero.
 */
// eslint-disable-next-line complexity -- records sessions, sets and all three PR kinds in one pass
export const buildProgress = (
  exercise: { key: string; name: string },
  workouts: WorkoutSets[],
  tz: string,
): StrengthProgress => {
  const sessions: StrengthProgress['sessions'] = []
  const rawSets: StrengthProgress['sets'] = []
  const repBest = new Map<number, { best_reps: number; date: string }>()
  let heaviest: StrengthProgress['prs']['heaviest_set']
  let bestE1rm: StrengthProgress['prs']['best_e1rm']
  let bestVolume: StrengthProgress['prs']['best_volume_session']

  for (const w of [...workouts].sort((a, b) => a.start_time.getTime() - b.start_time.getTime())) {
    const sets = sortSets(w.sets.filter((s) => keyOf(s) === exercise.key))
    if (sets.length === 0) continue
    const date = localDateOf(w.start_time, tz)
    const [summary] = summarizeExercises(sets)
    sessions.push({
      best_e1rm: summary!.best_e1rm,
      date,
      reps_total: summary!.reps_total,
      set_count: summary!.set_count,
      start_time: w.start_time.toISOString(),
      top_set: summary!.top_set,
      volume_kg: summary!.volume_kg,
      workout_id: w.workout_id,
    })
    if (!bestVolume || summary!.volume_kg > bestVolume.volume_kg) {
      bestVolume = { date, volume_kg: summary!.volume_kg, workout_id: w.workout_id }
    }
    for (const set of sets) {
      rawSets.push({ ...set, date, workout_id: w.workout_id })
      if (!isWorking(set) || set.weight === null || (set.reps ?? 0) < 1) continue
      if (!heaviest || set.weight > heaviest.weight!) {
        heaviest = { date, reps: set.reps, weight: set.weight, workout_id: w.workout_id }
      }
      const e1rm = estimatedOneRepMax(set)
      if (e1rm !== undefined && (!bestE1rm || e1rm > bestE1rm.e1rm)) {
        bestE1rm = { date, e1rm, reps: set.reps, weight: set.weight, workout_id: w.workout_id }
      }
      const prior = repBest.get(set.weight)
      if (!prior || set.reps! > prior.best_reps) repBest.set(set.weight, { best_reps: set.reps!, date })
    }
  }

  const weeks = new Map<string, StrengthProgress['weekly'][number]>()
  for (const s of sessions) {
    const week = mondayOf(s.date)
    const entry = weeks.get(week) ?? { best_e1rm: undefined, sessions: 0, volume_kg: 0, week_start: week }
    entry.sessions++
    entry.volume_kg = round1(entry.volume_kg + s.volume_kg)
    entry.best_e1rm = maxOf([entry.best_e1rm, s.best_e1rm])
    weeks.set(week, entry)
  }

  return {
    e1rm: {
      formula: 'epley',
      max_reps: E1RM_MAX_REPS,
      note: `Estimated 1RM = weight × (1 + reps / 30), from working sets of 1–${E1RM_MAX_REPS} reps. An estimate, not a tested max.`,
    },
    exercise,
    prs: { best_e1rm: bestE1rm, best_volume_session: bestVolume, heaviest_set: heaviest },
    rep_bests: [...repBest.entries()]
      .map(([weight, v]) => ({ ...v, weight }))
      .sort((a, b) => a.weight - b.weight),
    sessions,
    sets: rawSets,
    weekly: [...weeks.values()].sort((a, b) => a.week_start.localeCompare(b.week_start)),
  }
}
