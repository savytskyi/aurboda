import type { WorkoutCalendarConfig } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { WorkoutBadge } from '../../pages/Workouts/WorkoutBadge'
import { WorkoutCalendarGrid } from '../../pages/Workouts/WorkoutCalendar'
import {
  addDays,
  calendarWeeks,
  groupByDay,
  localDay,
  parseDay,
  strengthLogCounts,
  typesIn,
} from '../../pages/Workouts/workoutUtils'
import { fetchWorkouts } from '../../state/api'
import '../../pages/Workouts/style.css'

export function WorkoutCalendarWidget({ config }: { config: WorkoutCalendarConfig }) {
  const days = config.lookback_days ?? 30
  const to = localDay(new Date())
  const from = addDays(to, -(days - 1))
  const { data: workouts = [], isLoading } = useQuery({
    queryFn: () => fetchWorkouts(parseDay(from), parseDay(addDays(to, 1))),
    queryKey: ['workouts', from, to],
  })
  const byDay = groupByDay(workouts)
  const cells = calendarWeeks(from, to).flat()
  const types = typesIn(workouts)
  const strength = strengthLogCounts(workouts)
  const minutes = Math.round(workouts.reduce((s, w) => s + (w.duration_min ?? 0), 0))

  return (
    <a class="activity-summary workout-widget" href="/workouts">
      <h3>Workouts · last {days} days</h3>
      {isLoading ? (
        <div class="workout-empty">Loading…</div>
      ) : (
        <>
          <div class="workout-hint">
            {workouts.length} workouts · {byDay.size} training days · {Math.floor(minutes / 60)} h{' '}
            {minutes % 60} min
            {strength.logged + strength.unlogged > 0 &&
              ` · strength sets logged ${strength.logged}/${strength.logged + strength.unlogged}`}
          </div>
          <WorkoutCalendarGrid days={cells} byDay={byDay} from={from} to={to} maxRows={2} />
          <div class="zone-legend">
            {types.slice(0, 6).map((t) => (
              <span key={t.type}>
                <WorkoutBadge icon={t.icon} color={t.color} size="sm" />
                {t.name}
              </span>
            ))}
          </div>
        </>
      )}
    </a>
  )
}
