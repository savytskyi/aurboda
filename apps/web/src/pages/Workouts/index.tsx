import type { WorkoutSummary } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'preact/hooks'

import { BarChart } from '../../components/charts/BarChart'
import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { fetchMetricTimeSeries, fetchWorkouts } from '../../state/api'
import { auth } from '../../state/auth'
import { WorkoutBadge } from './WorkoutBadge'
import { WorkoutCalendarGrid } from './WorkoutCalendar'
import {
  addDays,
  calendarMonths,
  formatMinutes,
  groupByDay,
  localDay,
  logState,
  parseDay,
  sourceName,
  strengthLogCounts,
  trainingDaysPerWeek,
  typesIn,
  weeklyByType,
  weeksBetween,
  zoneTotals,
} from './workoutUtils'
import './style.css'

const PRESETS = [7, 30, 90] as const
const ZONE_COLORS = ['#cbd5e1', '#93c5fd', '#4ade80', '#facc15', '#fb923c', '#ef4444']

const today = () => localDay(new Date())

export function WorkoutChip({ workout }: { workout: WorkoutSummary }) {
  const time = new Date(workout.start_time).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
  return (
    <a class="workout-chip" href={`/workouts/${workout.id}`} style={{ borderLeftColor: workout.color }}>
      <span class="workout-chip-title">
        <WorkoutBadge
          icon={workout.icon}
          color={workout.color}
          outline={logState(workout) === 'unlogged'}
          size="sm"
        />{' '}
        {workout.title ?? workout.display_name}
        {logState(workout) === 'logged' && <span class="badge">sets logged</span>}
        {logState(workout) === 'unlogged' && <span class="badge warn">sets not logged</span>}
      </span>
      <span class="workout-chip-meta">
        {time} · {formatMinutes(workout.duration_min)}
        {workout.set_count > 0 && ` · ${workout.set_count} sets`}
        {workout.hr_avg !== undefined && ` · ♥ ${workout.hr_avg}`}
      </span>
      <span class="workout-chip-sources">{workout.sources.map(sourceName).join(' + ')}</span>
    </a>
  )
}

function Calendar({
  workouts,
  from,
  to,
  selected,
  onSelect,
}: {
  workouts: WorkoutSummary[]
  from: string
  to: string
  selected?: string
  onSelect: (day: string) => void
}) {
  const byDay = useMemo(() => groupByDay(workouts), [workouts])
  const months = useMemo(() => calendarMonths(from, to), [from, to])
  return (
    <div class="workout-calendars">
      {months.map((month) => (
        <div class="workout-month" key={month.key}>
          <h3>{month.label}</h3>
          <WorkoutCalendarGrid
            days={month.weeks.flat()}
            byDay={byDay}
            from={from}
            to={to}
            maxRows={3}
            selected={selected}
            onSelect={onSelect}
          />
        </div>
      ))}
    </div>
  )
}

function RecoveryContext({ from, to }: { from: string; to: string }) {
  const start = parseDay(from)
  const end = parseDay(addDays(to, 1))
  const metrics = [
    { color: '#8b5cf6', label: 'Sleep HRV', metric: 'hrv_sleep', unit: 'ms' },
    { color: '#ef4444', label: 'Resting HR', metric: 'resting_heart_rate', unit: 'bpm' },
    { color: '#22c55e', label: 'Readiness', metric: 'readiness_score', unit: '' },
  ]
  return (
    <section class="workout-section">
      <h2>Recovery context</h2>
      <p class="workout-hint">
        Nightly values from sleep, shown beside training — not measured during workouts.
      </p>
      <div class="recovery-grid">
        {metrics.map((m) => (
          <RecoveryMetric key={m.metric} {...m} start={start} end={end} />
        ))}
      </div>
    </section>
  )
}

function RecoveryMetric({
  metric,
  label,
  unit,
  color,
  start,
  end,
}: {
  metric: string
  label: string
  unit: string
  color: string
  start: Date
  end: Date
}) {
  const { data = [] } = useQuery({
    enabled: Boolean(auth.value.token),
    queryFn: () => fetchMetricTimeSeries(metric, start, end),
    queryKey: ['workout-recovery', metric, start.toISOString(), end.toISOString()],
  })
  const avg = (days: number) => {
    const cutoff = end.getTime() - days * 86_400_000
    const values = data.filter(([t]) => t.getTime() >= cutoff).map(([, v]) => v)
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : undefined
  }
  const a7 = avg(7)
  const a30 = avg(30)
  return (
    <div class="recovery-card">
      <div class="recovery-head">
        <strong>{label}</strong>
        <span>
          7d {a7 ?? '—'}
          {a7 !== undefined && unit ? ` ${unit}` : ''} · 30d {a30 ?? '—'}
          {a30 !== undefined && unit ? ` ${unit}` : ''}
        </span>
      </div>
      {data.length >= 2 ? (
        <TrendLineChart
          data={data.map(([t, v]) => ({ date: t.toISOString(), value: v }))}
          color={color}
          height={120}
          compact
        />
      ) : (
        <div class="workout-empty">No data in this range</div>
      )}
    </div>
  )
}

export function Workouts() {
  const [preset, setPreset] = useState<(typeof PRESETS)[number] | 'custom'>(30)
  const [customFrom, setCustomFrom] = useState(addDays(today(), -29))
  const [customTo, setCustomTo] = useState(today())
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [selectedDay, setSelectedDay] = useState<string | undefined>(undefined)

  const to = preset === 'custom' ? customTo : today()
  const from = preset === 'custom' ? customFrom : addDays(to, -(preset - 1))

  const {
    data: workouts = [],
    isLoading,
    error,
  } = useQuery({
    enabled: Boolean(auth.value.token),
    queryFn: () => fetchWorkouts(parseDay(from), parseDay(addDays(to, 1))),
    queryKey: ['workouts', from, to],
  })

  const types = useMemo(() => typesIn(workouts), [workouts])
  const shown = useMemo(() => workouts.filter((w) => !hidden.has(w.activity_type)), [workouts, hidden])
  const weeks = useMemo(() => weeksBetween(from, to), [from, to])
  const weekIso = (week: string) => parseDay(week).toISOString()

  const perWeekSeries = (value: (w: WorkoutSummary) => number) =>
    weeklyByType(shown, value).map((s) => ({
      color: s.type.color,
      data: weeks.map((week) => ({
        bucket_start: weekIso(week),
        value: Math.round((s.values.get(week) ?? 0) * 10) / 10,
      })),
      name: s.type.name,
    }))
  const countSeries = perWeekSeries(() => 1)
  const minuteSeries = perWeekSeries((w) => w.duration_min ?? 0)
  const days = trainingDaysPerWeek(shown)
  const daySeries = weeks.map((week) => ({ bucket_start: weekIso(week), value: days.get(week) ?? 0 }))
  const zones = zoneTotals(shown)
  const zoneTotal = zones.secs.reduce((a, b) => a + b, 0)
  const totalMinutes = shown.reduce((sum, w) => sum + (w.duration_min ?? 0), 0)
  const trainingDays = new Set(shown.map((w) => localDay(w.start_time))).size
  const strengthVolume = shown.reduce((sum, w) => sum + w.volume_kg, 0)
  const strengthCounts = strengthLogCounts(shown)
  const selectedList = selectedDay ? (groupByDay(shown).get(selectedDay) ?? []) : []
  const rangeStart = weekIso(weeks[0]!)
  const rangeEnd = weekIso(addDays(weeks.at(-1)!, 6))

  const toggle = (type: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })

  return (
    <div class="workouts-page">
      <div class="workouts-header">
        <h1>Workouts</h1>
        <a href="/strength" class="workouts-link">
          Strength progress →
        </a>
      </div>

      <div class="workouts-controls">
        <div class="segmented">
          {PRESETS.map((p) => (
            <button type="button" key={p} class={preset === p ? 'active' : ''} onClick={() => setPreset(p)}>
              {p} days
            </button>
          ))}
          <button
            type="button"
            class={preset === 'custom' ? 'active' : ''}
            onClick={() => setPreset('custom')}
          >
            Custom
          </button>
        </div>
        {preset === 'custom' && (
          <div class="custom-range">
            <input
              type="date"
              value={customFrom}
              max={customTo}
              onChange={(e) => setCustomFrom(e.currentTarget.value)}
            />
            <span>–</span>
            <input
              type="date"
              value={customTo}
              min={customFrom}
              onChange={(e) => setCustomTo(e.currentTarget.value)}
            />
          </div>
        )}
      </div>

      {types.length > 0 && (
        <div class="type-filters">
          {types.map((t) => (
            <button
              type="button"
              key={t.type}
              class={`type-filter${hidden.has(t.type) ? ' off' : ''}`}
              onClick={() => toggle(t.type)}
            >
              <WorkoutBadge icon={t.icon} color={t.color} size="sm" />
              {t.name}
            </button>
          ))}
        </div>
      )}

      <div class="mark-legend">
        <span>
          <WorkoutBadge icon="🏋️" color="#3b82f6" size="sm" /> sets logged / other workouts
        </span>
        <span>
          <WorkoutBadge icon="🏋️" color="#3b82f6" size="sm" outline /> strength session, sets not logged
        </span>
      </div>

      {error ? (
        <div class="workout-error">Could not load workouts.</div>
      ) : isLoading ? (
        <div class="workout-empty">Loading…</div>
      ) : (
        <>
          <div class="workout-stats">
            <div>
              <strong>{shown.length}</strong>
              <span>workouts</span>
            </div>
            <div>
              <strong>{formatMinutes(totalMinutes)}</strong>
              <span>training time</span>
            </div>
            <div>
              <strong>{trainingDays}</strong>
              <span>training days</span>
            </div>
            <div>
              <strong>
                {strengthCounts.logged} / {strengthCounts.logged + strengthCounts.unlogged}
              </strong>
              <span>strength sessions with sets logged</span>
            </div>
            <div>
              <strong>{Math.round(strengthVolume).toLocaleString()} kg</strong>
              <span>logged strength volume</span>
            </div>
          </div>

          <div class="workouts-layout">
            <Calendar workouts={shown} from={from} to={to} selected={selectedDay} onSelect={setSelectedDay} />
            <aside class="workout-day-panel">
              {selectedDay ? (
                <>
                  <h3>
                    {parseDay(selectedDay).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'long',
                      weekday: 'long',
                    })}
                  </h3>
                  {selectedList.length === 0 ? (
                    <div class="workout-empty">No workouts</div>
                  ) : (
                    selectedList.map((w) => <WorkoutChip key={w.id} workout={w} />)
                  )}
                </>
              ) : (
                <div class="workout-empty">Select a day to see its workouts.</div>
              )}
            </aside>
          </div>

          <section class="workout-section">
            <h2>Workouts per week</h2>
            <BarChart
              data={[]}
              multiSeries={countSeries}
              bucketSize="1w"
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              height={200}
            />
          </section>
          <section class="workout-section">
            <h2>Training minutes per week</h2>
            <BarChart
              data={[]}
              multiSeries={minuteSeries}
              bucketSize="1w"
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              height={200}
            />
          </section>
          <section class="workout-section">
            <h2>Training days per week</h2>
            <BarChart
              data={daySeries}
              color="#3b82f6"
              bucketSize="1w"
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              height={160}
            />
          </section>

          <section class="workout-section">
            <h2>Activity frequency</h2>
            <table class="workout-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Sessions</th>
                  <th>Per week</th>
                  <th>Total time</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                {typesIn(shown).map((t) => {
                  const list = shown.filter((w) => w.activity_type === t.type)
                  return (
                    <tr key={t.type}>
                      <td>
                        <span class="type-cell">
                          <WorkoutBadge icon={t.icon} color={t.color} size="sm" /> {t.name}
                        </span>
                      </td>
                      <td>{list.length}</td>
                      <td>{(list.length / Math.max(1, weeks.length)).toFixed(1)}</td>
                      <td>{formatMinutes(list.reduce((s, w) => s + (w.duration_min ?? 0), 0))}</td>
                      <td>{parseDay(localDay(list.at(-1)!.start_time)).toLocaleDateString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>

          <section class="workout-section">
            <h2>Time in heart-rate zones</h2>
            {zones.covered === 0 ? (
              <div class="workout-empty">
                Unavailable — no workout in this range has heart-rate zone data. Zones are computed only from
                configured zones (Settings → heart-rate zones) and recorded heart-rate samples.
              </div>
            ) : (
              <>
                <p class="workout-hint">
                  From {zones.covered} of {shown.length} workouts with heart-rate samples; coverage is often
                  partial.
                </p>
                <div class="zone-bar">
                  {zones.secs.map((s, z) =>
                    s > 0 ? (
                      <span
                        key={z}
                        style={{ background: ZONE_COLORS[z], flexGrow: s }}
                        title={`Zone ${z}: ${formatMinutes(s / 60)}`}
                      />
                    ) : null,
                  )}
                </div>
                <div class="zone-legend">
                  {zones.secs.map((s, z) => (
                    <span key={z}>
                      <span class="workout-mark" style={{ background: ZONE_COLORS[z] }} />
                      {z === 0 ? 'Below Z1' : `Z${z}`} {formatMinutes(s / 60)} (
                      {zoneTotal ? Math.round((s / zoneTotal) * 100) : 0}%)
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>

          <RecoveryContext from={from} to={to} />
        </>
      )}
    </div>
  )
}
