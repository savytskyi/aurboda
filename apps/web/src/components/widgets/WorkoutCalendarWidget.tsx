import type { WorkoutCalendarConfig } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { WorkoutBadge } from '../../pages/Workouts/WorkoutBadge'
import {
  addDays,
  groupByDay,
  localDay,
  logState,
  markLabel,
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
  const cells = Array.from({ length: days }, (_, i) => addDays(from, i))
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
          <div class="workout-widget-grid">
            {cells.map((day) => {
              const list = byDay.get(day) ?? []
              return (
                <span
                  key={day}
                  class="workout-widget-cell"
                  title={`${day}: ${list.map(markLabel).join('; ') || 'rest'}`}
                >
                  {list.slice(0, 2).map((w) => (
                    <WorkoutBadge
                      key={w.id}
                      icon={w.icon}
                      color={w.color}
                      outline={logState(w) === 'unlogged'}
                      size="sm"
                    />
                  ))}
                  {list.length > 2 && <span class="workout-more">+{list.length - 2}</span>}
                </span>
              )
            })}
          </div>
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
