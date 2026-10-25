import type { GoalProgress, HealthDailyPoint, WorkoutSummary } from '@aurboda/api-spec'

import type { StatusTone } from './StatusChip'

import { formatMetricValue } from './format'

/** Share of Oura's walking-equivalent target reached, clamped to [0, 1]. */
export const dailyTargetProgress = (
  metersToTarget: number,
  targetMeters: number,
): { met: boolean; progress: number } | null => {
  if (!Number.isFinite(metersToTarget) || !Number.isFinite(targetMeters) || targetMeters <= 0) return null
  const progress = Math.min(1, Math.max(0, 1 - metersToTarget / targetMeters))
  return { met: metersToTarget <= 0, progress }
}

export const targetProgressByDay = (
  metersToTarget: readonly HealthDailyPoint[],
  target: readonly HealthDailyPoint[],
): Map<string, { met: boolean; progress: number }> => {
  const targetByDay = new Map(target.map((p) => [p.date, p.value]))
  const result = new Map<string, { met: boolean; progress: number }>()
  for (const p of metersToTarget) {
    const t = targetByDay.get(p.date)
    const status = t === undefined ? null : dailyTargetProgress(p.value, t)
    if (status) result.set(p.date, status)
  }
  return result
}

/** "Avg 8,640 steps · target met on 50 of 90 days". */
export const stepsSummaryText = (
  steps: readonly HealthDailyPoint[],
  targets: ReadonlyMap<string, { met: boolean }>,
): string | null => {
  const parts: string[] = []
  if (steps.length > 0) {
    const avg = steps.reduce((sum, p) => sum + p.value, 0) / steps.length
    parts.push(`Avg ${formatMetricValue('steps', avg)} steps`)
  }
  if (targets.size > 0) {
    const met = [...targets.values()].filter((t) => t.met).length
    parts.push(`target met on ${met} of ${targets.size} days`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

const WINDOW_DAYS: Record<string, number> = { M: 30, d: 1, w: 7 }

/** Days in a goal window (`7d`, `2w`, `1M`); null for sub-day windows. */
export const windowDays = (window: string): number | null => {
  const match = /^(\d+)([smhdwM])$/.exec(window)
  if (!match) return null
  const perUnit = WINDOW_DAYS[match[2] ?? '']
  const n = Number(match[1])
  return perUnit === undefined || n <= 0 ? null : n * perUnit
}

/** Daily steps threshold of a `steps` metric goal with a minimum, spread evenly over its window. */
export const stepsGoalPerDay = (goals: readonly GoalProgress[] | undefined): number | null => {
  for (const goal of goals ?? []) {
    if (goal.goal_type !== 'metric' || goal.metric !== 'steps' || goal.min === undefined) continue
    const days = windowDays(goal.window)
    if (days !== null) return Math.round(goal.min / days)
  }
  return null
}

export type WorkoutIntensity = NonNullable<WorkoutSummary['intensity']>

export const INTENSITY_CHIPS: Record<WorkoutIntensity, { label: string; tone: StatusTone; icon: string }> = {
  easy: { icon: '○', label: 'Easy', tone: 'info' },
  hard: { icon: '▲', label: 'Hard', tone: 'info' },
  moderate: { icon: '◆', label: 'Moderate', tone: 'info' },
}

export interface WorkoutTotals {
  byIntensity: Record<WorkoutIntensity | 'unlabelled', number>
  calories: number
  count: number
  durationMin: number
  strength: { logged: number; sessions: number; sets: number; volumeKg: number }
}

export const workoutTotals = (workouts: readonly WorkoutSummary[]): WorkoutTotals => {
  const totals: WorkoutTotals = {
    byIntensity: { easy: 0, hard: 0, moderate: 0, unlabelled: 0 },
    calories: 0,
    count: workouts.length,
    durationMin: 0,
    strength: { logged: 0, sessions: 0, sets: 0, volumeKg: 0 },
  }
  for (const w of workouts) {
    totals.byIntensity[w.intensity ?? 'unlabelled'] += 1
    totals.calories += w.calories ?? 0
    totals.durationMin += w.duration_min ?? 0
    if (w.sets_status !== 'not_applicable') {
      totals.strength.sessions += 1
      if (w.sets_status === 'logged') totals.strength.logged += 1
      totals.strength.sets += w.set_count
      totals.strength.volumeKg += w.volume_kg
    }
  }
  return totals
}

/** "2 hard · 5 moderate · 1 easy" (unlabelled sessions are left out). */
export const intensityCountsText = (byIntensity: WorkoutTotals['byIntensity']): string | null => {
  const parts = (['hard', 'moderate', 'easy'] as const)
    .filter((k) => byIntensity[k] > 0)
    .map((k) => `${byIntensity[k]} ${k}`)
  return parts.length > 0 ? parts.join(' · ') : null
}
