import type { StrengthProgress as Progress } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useMemo, useState } from 'preact/hooks'

import { BarChart } from '../../components/charts/BarChart'
import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { fetchExercises, fetchStrengthProgress } from '../../state/api'
import { auth } from '../../state/auth'
import { parseDay } from '../Workouts/workoutUtils'
import '../Workouts/style.css'

const MAIN_LIFTS = [
  { key: 'bench_press', name: 'Bench Press' },
  { key: 'squat', name: 'Squat' },
  { key: 'deadlift', name: 'Deadlift' },
  { key: 'overhead_press', name: 'Overhead Press' },
]

const RANGES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 182, label: '6 months' },
  { days: 365, label: '1 year' },
  { days: 0, label: 'All time' },
] as const

const kg = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v} kg`)

const dayLabel = (date: string) =>
  parseDay(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' })

function LiftCard({
  lift,
  active,
  onSelect,
}: {
  lift: { key: string; name: string }
  active: boolean
  onSelect: () => void
}) {
  const { data } = useQuery({
    enabled: Boolean(auth.value.token),
    queryFn: () => fetchStrengthProgress(lift.key),
    queryKey: ['strength-progress', lift.key, 'all'],
  })
  const last = data?.sessions.at(-1)
  return (
    <button type="button" class={`lift-card${active ? ' active' : ''}`} onClick={onSelect}>
      <h3>{lift.name}</h3>
      {!data ? (
        <div class="small">Loading…</div>
      ) : data.sessions.length === 0 ? (
        <div class="small">No sets logged yet</div>
      ) : (
        <>
          <div class="big">{kg(data.prs.best_e1rm?.e1rm)}</div>
          <div class="small">best estimated 1RM</div>
          <div class="small">
            Last: {dayLabel(last!.date)} · top set {kg(last!.top_set?.weight)} × {last!.top_set?.reps ?? '—'}
          </div>
          <div class="small">{data.sessions.length} sessions logged</div>
        </>
      )}
    </button>
  )
}

function ProgressCharts({ progress, weekly }: { progress: Progress; weekly: boolean }) {
  const e1rm = progress.sessions
    .filter((s) => s.best_e1rm !== undefined)
    .map((s) => ({ date: s.start_time, value: s.best_e1rm! }))
  const top = progress.sessions
    .filter((s) => s.top_set?.weight !== null && s.top_set?.weight !== undefined)
    .map((s) => ({ date: s.start_time, value: s.top_set!.weight! }))
  const volume = weekly
    ? progress.weekly.map((w) => ({ bucket_start: parseDay(w.week_start).toISOString(), value: w.volume_kg }))
    : progress.sessions.map((s) => ({ bucket_start: s.start_time, value: s.volume_kg }))
  const reps = progress.sessions.map((s) => ({ date: s.start_time, value: s.reps_total }))
  const single = (n: number) => n < 2

  return (
    <>
      <section class="workout-section">
        <h2>Estimated 1RM</h2>
        <p class="workout-hint">{progress.e1rm.note}</p>
        {single(e1rm.length) ? (
          <div class="workout-empty">
            {e1rm.length === 1
              ? `One session: ${e1rm[0]!.value} kg.`
              : 'No working sets in the 1–12 rep range.'}
          </div>
        ) : (
          <TrendLineChart data={e1rm} color="#3b82f6" height={200} />
        )}
      </section>
      <section class="workout-section">
        <h2>Working weight (heaviest working set per session)</h2>
        {single(top.length) ? (
          <div class="workout-empty">
            {top.length === 1 ? `One session: ${top[0]!.value} kg.` : 'No weighted sets.'}
          </div>
        ) : (
          <TrendLineChart data={top} color="#f97316" height={200} />
        )}
      </section>
      <section class="workout-section">
        <h2>Training volume {weekly ? 'per week' : 'per session'}</h2>
        <p class="workout-hint">
          Σ weight × reps of non-warm-up sets. A volume record is not a strength record.
        </p>
        {volume.length === 0 ? (
          <div class="workout-empty">No volume logged.</div>
        ) : (
          <BarChart data={volume} color="#22c55e" bucketSize={weekly ? '1w' : '1d'} height={180} />
        )}
      </section>
      <section class="workout-section">
        <h2>Reps per session</h2>
        {single(reps.length) ? (
          <div class="workout-empty">
            {reps.length === 1 ? `One session: ${reps[0]!.value} reps.` : 'No reps logged.'}
          </div>
        ) : (
          <TrendLineChart data={reps} color="#8b5cf6" height={160} />
        )}
      </section>
      {progress.rep_bests.length > 0 && (
        <section class="workout-section">
          <h2>Best reps at each weight</h2>
          <table class="workout-table">
            <thead>
              <tr>
                <th>Weight</th>
                <th>Best reps</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {progress.rep_bests.map((r) => (
                <tr key={r.weight}>
                  <td>{kg(r.weight)}</td>
                  <td>{r.best_reps}</td>
                  <td>{dayLabel(r.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}

// eslint-disable-next-line complexity -- a page of independent optional sections
export function StrengthProgress() {
  const { query, route } = useLocation()
  const [rangeDays, setRangeDays] = useState<number>(90)
  const [weekly, setWeekly] = useState(false)
  const [search, setSearch] = useState('')
  const selected = query.exercise || 'bench_press'
  const select = (key: string) => route(`/strength?exercise=${encodeURIComponent(key)}`, true)

  const { data: exercises = [] } = useQuery({
    enabled: Boolean(auth.value.token),
    queryFn: fetchExercises,
    queryKey: ['exercises'],
  })
  const start = useMemo(
    () => (rangeDays ? new Date(Date.now() - rangeDays * 86_400_000) : undefined),
    [rangeDays],
  )
  const { data: progress, isLoading } = useQuery({
    enabled: Boolean(auth.value.token),
    queryFn: () => fetchStrengthProgress(selected, start),
    queryKey: ['strength-progress', selected, rangeDays],
  })

  const logged = exercises.filter((e) => e.logged_sets > 0)
  const matches = search.trim()
    ? exercises.filter((e) =>
        [e.name, e.key, ...e.aliases].some((n) => n.toLowerCase().includes(search.trim().toLowerCase())),
      )
    : logged

  return (
    <div class="strength-page">
      <div class="workouts-header">
        <h1>Strength Progress</h1>
        <a href="/workouts" class="workouts-link">
          ← Workouts
        </a>
      </div>

      <div class="lift-cards">
        {MAIN_LIFTS.map((lift) => (
          <LiftCard
            key={lift.key}
            lift={lift}
            active={selected === lift.key}
            onSelect={() => select(lift.key)}
          />
        ))}
      </div>

      <div class="exercise-picker">
        <label>
          Exercise{' '}
          <input
            type="search"
            list="exercise-options"
            placeholder={logged.length ? 'Search logged exercises' : 'Search exercises'}
            value={search}
            onInput={(e) => {
              const value = e.currentTarget.value
              setSearch(value)
              const exact = exercises.find((x) => x.name.toLowerCase() === value.toLowerCase())
              if (exact) select(exact.key)
            }}
          />
          <datalist id="exercise-options">
            {matches.map((e) => (
              <option key={e.key} value={e.name}>
                {e.logged_sets > 0 ? `${e.logged_sets} sets` : 'not logged'}
              </option>
            ))}
          </datalist>
        </label>
        <select value={selected} onChange={(e) => select(e.currentTarget.value)}>
          {(logged.length ? logged : exercises).map((e) => (
            <option key={e.key} value={e.key}>
              {e.name} {e.logged_sets > 0 ? `(${e.logged_sets})` : ''}
            </option>
          ))}
          {!exercises.some((e) => e.key === selected) && <option value={selected}>{selected}</option>}
        </select>
        <div class="segmented">
          {RANGES.map((r) => (
            <button
              type="button"
              key={r.label}
              class={rangeDays === r.days ? 'active' : ''}
              onClick={() => setRangeDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <label>
          <input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.currentTarget.checked)} />{' '}
          Weekly volume
        </label>
      </div>

      {isLoading || !progress ? (
        <div class="workout-empty">Loading…</div>
      ) : progress.sessions.length === 0 ? (
        <div class="workout-empty">
          No {progress.exercise.name} sets logged in this period. Log sets through Hermes (&quot;
          {progress.exercise.name.toLowerCase()} 5x5 50kg&quot;) or on a workout&apos;s page.
        </div>
      ) : (
        <>
          <h2 style={{ fontSize: '1.15rem' }}>{progress.exercise.name}</h2>
          <div class="pr-grid">
            <div>
              <div class="workout-hint">Heaviest working set</div>
              <strong>
                {kg(progress.prs.heaviest_set?.weight)} × {progress.prs.heaviest_set?.reps ?? '—'}
              </strong>
              <div class="workout-hint">
                {progress.prs.heaviest_set && dayLabel(progress.prs.heaviest_set.date)}
              </div>
            </div>
            <div>
              <div class="workout-hint">Highest estimated 1RM</div>
              <strong>{kg(progress.prs.best_e1rm?.e1rm)}</strong>
              <div class="workout-hint">
                {progress.prs.best_e1rm &&
                  `${progress.prs.best_e1rm.weight} kg × ${progress.prs.best_e1rm.reps} · ${dayLabel(progress.prs.best_e1rm.date)}`}
              </div>
            </div>
            <div>
              <div class="workout-hint">Best volume session</div>
              <strong>{kg(progress.prs.best_volume_session?.volume_kg)}</strong>
              <div class="workout-hint">
                {progress.prs.best_volume_session && dayLabel(progress.prs.best_volume_session.date)}
              </div>
            </div>
            <div>
              <div class="workout-hint">Sessions in range</div>
              <strong>{progress.sessions.length}</strong>
            </div>
          </div>

          <ProgressCharts progress={progress} weekly={weekly} />

          <section class="workout-section">
            <h2>All sets</h2>
            <div class="workout-table-wrap">
              <table class="workout-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Set</th>
                    <th>Weight</th>
                    <th>Reps</th>
                    <th>RPE</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {[...progress.sets].reverse().map((s) => (
                    <tr key={s.set_id ?? `${s.workout_id}-${s.order}`}>
                      <td>
                        <a href={`/workouts/${s.workout_id}`}>{dayLabel(s.date)}</a>
                      </td>
                      <td>{s.order}</td>
                      <td>{s.bodyweight ? `BW${s.weight ? ` + ${s.weight} kg` : ''}` : kg(s.weight)}</td>
                      <td>{s.reps ?? (s.time !== null ? `${s.time} s` : '—')}</td>
                      <td>{s.rpe ?? ''}</td>
                      <td>{s.set_type === 'normal' ? 'working' : s.set_type.replace('_', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
