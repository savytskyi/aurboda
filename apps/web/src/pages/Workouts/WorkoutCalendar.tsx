import type { WorkoutSummary } from '@aurboda/api-spec'

import { WorkoutGlyph } from './WorkoutBadge'
import { type CalendarEntry, calendarEntries, localDay, logState, markLabel, parseDay } from './workoutUtils'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function EntryRow({ entry: { workout, members } }: { entry: CalendarEntry }) {
  const merged = members.length > 1
  return (
    <span
      class={`cal-entry${logState(workout) === 'unlogged' ? ' unlogged' : ''}`}
      style={{ '--type-color': workout.color }}
      title={members.map(markLabel).join('\n')}
    >
      <span class="cal-entry-icon">
        <WorkoutGlyph icon={workout.icon} color={workout.color} />
      </span>
      <span class="cal-entry-name">
        {merged ? workout.display_name : (workout.title ?? workout.display_name)}
      </span>
      {merged && <span class="cal-entry-count">×{members.length}</span>}
    </span>
  )
}

/** Without `onSelect` days are plain cells: the dashboard widget is itself a link, which cannot contain buttons. */
export function WorkoutCalendarGrid({
  days,
  byDay,
  from,
  to,
  maxRows,
  selected,
  onSelect,
}: {
  days: (string | null)[]
  byDay: Map<string, WorkoutSummary[]>
  from: string
  to: string
  maxRows: number
  selected?: string
  onSelect?: (day: string) => void
}) {
  const today = localDay(new Date())
  return (
    <div class="cal-grid">
      {WEEKDAYS.map((d) => (
        <div class="cal-weekday" key={d}>
          {d}
        </div>
      ))}
      {days.map((day, i) => {
        if (!day) return <div class="cal-day pad" key={`pad-${i}`} />
        const list = byDay.get(day) ?? []
        const entries = calendarEntries(list)
        const shown = entries.length > maxRows ? entries.slice(0, maxRows - 1) : entries
        const classes = [
          'cal-day',
          day < from || day > to ? 'outside' : '',
          day === today ? 'today' : '',
          day === selected ? 'selected' : '',
          list.length ? 'has' : '',
        ]
          .filter(Boolean)
          .join(' ')
        const content = (
          <>
            <span class="cal-day-num">{parseDay(day).getDate()}</span>
            <span class="cal-entries">
              {shown.map((entry) => (
                <EntryRow key={entry.workout.id} entry={entry} />
              ))}
              {entries.length > shown.length && (
                <span class="cal-more">
                  +{entries.length - shown.length}
                  <span class="cal-more-word"> more</span>
                </span>
              )}
            </span>
          </>
        )
        const label = `${day}: ${list.map(markLabel).join('; ') || 'no workouts'}`
        return onSelect ? (
          <button type="button" key={day} class={classes} onClick={() => onSelect(day)} aria-label={label}>
            {content}
          </button>
        ) : (
          <div key={day} class={classes} title={label}>
            {content}
          </div>
        )
      })}
    </div>
  )
}
