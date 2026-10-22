import type { WorkoutCalendarConfig } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { addDays, groupByDay, localDay, parseDay, typesIn } from '../../pages/Workouts/workoutUtils'
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
          </div>
          <div class="workout-widget-grid">
            {cells.map((day) => {
              const list = byDay.get(day) ?? []
              return (
                <span
                  key={day}
                  class="workout-widget-cell"
                  title={`${day}: ${list.map((w) => w.display_name).join(', ') || 'rest'}`}
                >
                  {list.slice(0, 3).map((w) => (
                    <span key={w.id} style={{ background: w.color }} />
                  ))}
                </span>
              )
            })}
          </div>
          <div class="zone-legend">
            {types.slice(0, 6).map((t) => (
              <span key={t.type}>
                <span class="workout-mark" style={{ background: t.color }} />
                {t.name}
              </span>
            ))}
          </div>
        </>
      )}
    </a>
  )
}
