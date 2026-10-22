import type { StrengthSet, StrengthSetType, WorkoutDetail as Workout } from '@aurboda/api-spec'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import {
  deleteStrengthSet,
  deleteWorkoutActivity,
  fetchWorkout,
  linkWorkout,
  logStrengthSets,
  unlinkWorkout,
  updateActivity,
  updateStrengthSet,
} from '../../state/api'
import { auth } from '../../state/auth'
import { WorkoutBadge } from './WorkoutBadge'
import { formatMinutes, logState, sourceName } from './workoutUtils'
import './style.css'

const ZONE_COLORS = ['#cbd5e1', '#93c5fd', '#4ade80', '#facc15', '#fb923c', '#ef4444']
const SET_TYPES: StrengthSetType[] = ['normal', 'warmup', 'drop_set', 'failure']
const SET_TYPE_LABELS: Record<StrengthSetType, string> = {
  drop_set: 'Drop set',
  failure: 'Failure',
  normal: 'Working',
  warmup: 'Warm-up',
}

const timeOf = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '?'

const toLocalInput = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const errorText = (e: unknown): string =>
  (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? String(e)

function SetRow({
  set,
  workoutId,
  editable,
  onChanged,
}: {
  set: StrengthSet
  workoutId: string
  editable: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [weight, setWeight] = useState(set.weight ?? '')
  const [reps, setReps] = useState(set.reps ?? '')
  const [rpe, setRpe] = useState(set.rpe ?? '')
  const [type, setType] = useState<StrengthSetType>(set.set_type)
  const [busy, setBusy] = useState(false)
  const num = (v: string | number) => (v === '' ? null : Number(v))

  const save = async () => {
    setBusy(true)
    try {
      await updateStrengthSet(workoutId, set.set_id!, {
        reps: num(reps),
        rpe: num(rpe),
        set_type: type,
        weight: num(weight),
      })
      setEditing(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!confirm(`Delete set ${set.order} of ${set.exercise}?`)) return
    setBusy(true)
    try {
      await deleteStrengthSet(workoutId, set.set_id!)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const load = set.bodyweight
    ? (set.weight ?? 0) > 0
      ? `BW + ${set.weight} kg`
      : 'Bodyweight'
    : set.weight !== null
      ? `${set.weight} kg`
      : '—'

  if (editing) {
    return (
      <tr class="set-row">
        <td>{set.order}</td>
        <td>
          <input
            type="number"
            min="0"
            step="0.5"
            value={weight}
            onInput={(e) => setWeight(e.currentTarget.value)}
          />{' '}
          kg
        </td>
        <td>
          <input type="number" min="0" value={reps} onInput={(e) => setReps(e.currentTarget.value)} />
        </td>
        <td>
          <input
            type="number"
            min="0"
            max="10"
            step="0.5"
            value={rpe}
            onInput={(e) => setRpe(e.currentTarget.value)}
          />
        </td>
        <td>
          <select value={type} onChange={(e) => setType(e.currentTarget.value as StrengthSetType)}>
            {SET_TYPES.map((t) => (
              <option key={t} value={t}>
                {SET_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </td>
        <td>
          <button type="button" class="btn-small primary" disabled={busy} onClick={save}>
            Save
          </button>{' '}
          <button type="button" class="btn-small" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </td>
      </tr>
    )
  }
  return (
    <tr class="set-row">
      <td>{set.order}</td>
      <td>{load}</td>
      <td>{set.reps ?? (set.time !== null ? `${set.time} s` : '—')}</td>
      <td>{set.rpe ?? ''}</td>
      <td>{SET_TYPE_LABELS[set.set_type]}</td>
      <td>
        {editable && set.set_id && (
          <>
            <button type="button" class="btn-small" onClick={() => setEditing(true)}>
              Edit
            </button>{' '}
            <button type="button" class="btn-small danger" disabled={busy} onClick={remove}>
              Delete
            </button>
          </>
        )}
      </td>
    </tr>
  )
}

function HeartRate({ workout }: { workout: Workout }) {
  const hr = workout.heart_rate
  if (hr.status === 'unavailable') {
    return (
      <div class="workout-empty">Heart rate: unavailable — no samples were recorded during this session.</div>
    )
  }
  const zoneTotal = hr.zone_secs ? Object.values(hr.zone_secs).reduce((a, b) => a + b, 0) : 0
  return (
    <>
      <div class="metric-grid">
        <div>
          <div class="label">Average HR</div>
          <div class="value">{hr.avg ?? '—'} bpm</div>
        </div>
        <div>
          <div class="label">Max HR</div>
          <div class="value">{hr.max ?? '—'} bpm</div>
        </div>
        <div>
          <div class="label">Coverage</div>
          <div class="value">{Math.round(hr.coverage * 100)}%</div>
          <div class="from">{hr.sample_count} samples</div>
        </div>
      </div>
      {hr.status === 'sparse' && (
        <p class="workout-hint">
          <span class="badge warn">Sparse</span> Samples cover under half of the session&apos;s minutes;
          averages and zones describe only the covered part.
        </p>
      )}
      {hr.overlapping_activity_ids.length > 0 && (
        <p class="workout-hint">
          <span class="badge warn">Overlap</span> Another workout overlaps this one; the same heart-rate
          samples also count for it.
        </p>
      )}
      {hr.zone_secs && zoneTotal > 0 ? (
        <>
          <div class="zone-bar" style={{ marginTop: '0.5rem' }}>
            {[0, 1, 2, 3, 4, 5].map((z) => {
              const s = hr.zone_secs![z as 0]
              return s > 0 ? <span key={z} style={{ background: ZONE_COLORS[z], flexGrow: s }} /> : null
            })}
          </div>
          <div class="zone-legend">
            {[0, 1, 2, 3, 4, 5].map((z) => (
              <span key={z}>
                <span class="workout-mark" style={{ background: ZONE_COLORS[z] }} />
                {z === 0 ? 'Below Z1' : `Z${z}`} {formatMinutes(hr.zone_secs![z as 0] / 60)}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p class="workout-hint">
          HR zones:{' '}
          {hr.zone_source === 'default'
            ? 'not configured — set your zones in Settings to see them'
            : 'unavailable'}
          .
        </p>
      )}
    </>
  )
}

function EditMeta({ workout, onDone }: { workout: Workout; onDone: () => void }) {
  const [title, setTitle] = useState(workout.title ?? '')
  const [start, setStart] = useState(toLocalInput(workout.start_time))
  const [end, setEnd] = useState(toLocalInput(workout.end_time))
  const [notes, setNotes] = useState(workout.notes ?? '')
  const [error, setError] = useState<string>()
  const manualId =
    workout.sources_detail.find(
      (s) => s.source === 'hermes' || s.source === 'web' || s.source === 'api' || s.source === 'mcp',
    )?.activity_id ?? workout.id
  const save = async () => {
    try {
      await updateActivity(manualId, {
        end_time: end ? new Date(end).toISOString() : undefined,
        notes,
        start_time: start ? new Date(start).toISOString() : undefined,
        title: title || undefined,
      })
      onDone()
    } catch (e) {
      setError(errorText(e))
    }
  }
  return (
    <div class="inline-form" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <label>
        Title <input type="text" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
      </label>
      <label>
        Start <input type="datetime-local" value={start} onInput={(e) => setStart(e.currentTarget.value)} />
      </label>
      <label>
        End <input type="datetime-local" value={end} onInput={(e) => setEnd(e.currentTarget.value)} />
      </label>
      <label>
        Notes
        <textarea rows={3} value={notes} onInput={(e) => setNotes(e.currentTarget.value)} />
      </label>
      {error && <div class="workout-error">{error}</div>}
      <div>
        <button type="button" class="btn-small primary" onClick={save}>
          Save
        </button>{' '}
        <button type="button" class="btn-small" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// eslint-disable-next-line complexity -- a page of independent optional sections
export function WorkoutDetail() {
  const { params } = useRoute()
  const { route } = useLocation()
  const id = params.id!
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [message, setMessage] = useState<string>()
  const [editingMeta, setEditingMeta] = useState(false)

  const {
    data: workout,
    error,
    isLoading,
  } = useQuery({
    enabled: Boolean(auth.value.token),
    queryFn: () => fetchWorkout(id),
    queryKey: ['workout', id],
  })

  const refresh = async (nextId?: string) => {
    await queryClient.invalidateQueries({ queryKey: ['workouts'] })
    if (nextId && nextId !== id) route(`/workouts/${nextId}`)
    else await queryClient.invalidateQueries({ queryKey: ['workout', id] })
  }

  if (isLoading) return <div class="workout-detail workout-empty">Loading…</div>
  if (error || !workout) return <div class="workout-detail workout-error">Workout not found.</div>

  const manualMember = workout.sources_detail.find((s) =>
    ['hermes', 'web', 'api', 'mcp', 'aurboda'].includes(s.source),
  )
  const editableSets = Boolean(manualMember) && workout.provenance.sets !== 'gravl'
  const strength = ['strength_training', 'weightlifting', 'calisthenics'].includes(workout.activity_type)
  const date = new Date(workout.start_time).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    year: 'numeric',
  })
  const exerciseKeys = [...new Set(workout.sets.map((s) => s.exercise_key ?? s.exercise))]

  const addSets = async () => {
    if (!text.trim()) return
    try {
      const result = await logStrengthSets({ text, workout_id: manualMember?.activity_id ?? workout.id })
      setText('')
      setMessage(result.summary_text)
      await refresh(result.workout?.id)
    } catch (e) {
      setMessage(errorText(e))
    }
  }

  const removeWorkout = async () => {
    if (!manualMember) return
    if (!confirm('Delete the manually logged sets of this workout? Synced data stays.')) return
    await deleteWorkoutActivity(manualMember.activity_id)
    await queryClient.invalidateQueries({ queryKey: ['workouts'] })
    route('/workouts')
  }

  return (
    <div class="workout-detail">
      <a href="/workouts">← Workouts</a>
      <div class="workout-detail-head" style={{ borderLeftColor: workout.color }}>
        <h1 class="workout-detail-title">
          <WorkoutBadge
            icon={workout.icon}
            color={workout.color}
            outline={logState(workout) === 'unlogged'}
          />
          {workout.title ?? workout.display_name}
        </h1>
        <div class="sub">
          {workout.display_name} · {date} · {timeOf(workout.start_time)}
          {workout.end_time && `–${timeOf(workout.end_time)}`} · {formatMinutes(workout.duration_min)}
        </div>
        <div style={{ marginTop: '0.4rem' }}>
          {workout.sources.map((s) => (
            <span class="badge" key={s}>
              {sourceName(s)}
            </span>
          ))}
          {workout.time_source === 'message_time' && <span class="badge muted">time from message</span>}
          {workout.time_source === 'date_only' && <span class="badge warn">time not recorded</span>}
        </div>
      </div>

      <div class="metric-grid">
        <div>
          <div class="label">Duration</div>
          <div class="value">{formatMinutes(workout.duration_min)}</div>
          <div class="from">from {sourceName(workout.provenance.time ?? '')}</div>
        </div>
        <div>
          <div class="label">Calories</div>
          <div class="value">{workout.calories !== undefined ? `${workout.calories} kcal` : '—'}</div>
          {workout.provenance.calories && (
            <div class="from">from {sourceName(workout.provenance.calories)}</div>
          )}
        </div>
        {workout.distance !== undefined && (
          <div>
            <div class="label">Distance</div>
            <div class="value">{(workout.distance / 1000).toFixed(2)} km</div>
            <div class="from">from {sourceName(workout.provenance.distance ?? '')}</div>
          </div>
        )}
        {(strength || workout.set_count > 0) && (
          <>
            <div>
              <div class="label">Sets</div>
              <div class="value">{workout.set_count}</div>
              {workout.provenance.sets && <div class="from">from {sourceName(workout.provenance.sets)}</div>}
            </div>
            <div>
              <div class="label">Volume</div>
              <div class="value">{workout.volume_kg.toLocaleString()} kg</div>
              <div class="from">Σ weight × reps, warm-ups excluded</div>
            </div>
          </>
        )}
      </div>

      {(strength || workout.set_count > 0) && (
        <section class="workout-section">
          <h2>Exercises</h2>
          {workout.sets_status === 'not_logged' && (
            <p class="workout-empty">Exercise details not logged for this session.</p>
          )}
          {exerciseKeys.map((key) => {
            const sets = workout.sets.filter((s) => (s.exercise_key ?? s.exercise) === key)
            const summary = workout.exercises.find((e) => e.exercise_key === key)
            return (
              <div key={key} style={{ marginBottom: '0.75rem' }}>
                <h3 style={{ margin: '0.3rem 0', fontSize: '0.95rem' }}>
                  <a href={`/strength?exercise=${encodeURIComponent(key)}`}>{sets[0]!.exercise}</a>{' '}
                  <span class="workout-hint">
                    {summary?.set_count} sets · {summary?.volume_kg} kg
                    {summary?.best_e1rm !== undefined && ` · e1RM ≈ ${summary.best_e1rm} kg`}
                  </span>
                </h3>
                <div class="workout-table-wrap">
                  <table class="workout-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Weight</th>
                        <th>Reps</th>
                        <th>RPE</th>
                        <th>Type</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {sets.map((s) => (
                        <SetRow
                          key={s.set_id ?? `${key}-${s.order}`}
                          set={s}
                          workoutId={workout.id}
                          editable={editableSets}
                          onChanged={() => refresh()}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
          <div class="inline-form">
            <input
              type="text"
              placeholder='Add sets, e.g. "bench 5x5 50kg, squat 3x8 70kg"'
              value={text}
              onInput={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && addSets()}
            />
            <button type="button" class="btn-small primary" onClick={addSets}>
              Add sets
            </button>
          </div>
          {message && (
            <pre class="workout-hint" style={{ whiteSpace: 'pre-wrap' }}>
              {message}
            </pre>
          )}
        </section>
      )}

      <section class="workout-section">
        <h2>Heart rate</h2>
        <HeartRate workout={workout} />
      </section>

      {(workout.suggestions.length > 0 || workout.links.length > 0) && (
        <section class="workout-section">
          <h2>Sources and links</h2>
          {workout.links
            .filter((l) => l.status === 'confirmed')
            .map((l) => {
              const other =
                l.primary_id === (manualMember?.activity_id ?? workout.id) ? l.linked_id : l.primary_id
              const detail = workout.sources_detail.find((s) => s.activity_id === other)
              return (
                <div class="suggestion" key={`${l.primary_id}-${l.linked_id}`}>
                  <span>
                    🔗 Merged with {sourceName(detail?.source ?? 'activity')} {detail?.title ?? ''}{' '}
                    {timeOf(detail?.start_time)}–{timeOf(detail?.end_time)}{' '}
                    <span class="workout-hint">
                      ({l.method === 'auto' ? `auto, ${l.reasons.join('; ')}` : 'confirmed'})
                    </span>
                  </span>
                  <button
                    type="button"
                    class="btn-small"
                    onClick={async () => {
                      await unlinkWorkout(l.primary_id, l.linked_id)
                      await refresh()
                    }}
                  >
                    Unlink
                  </button>
                </div>
              )
            })}
          {workout.suggestions.map((s) => (
            <div class="suggestion" key={s.activity_id}>
              <span>
                ❓ Possibly the same workout: {sourceName(s.source)} {s.title ?? s.activity_type}{' '}
                {timeOf(s.start_time)}–{timeOf(s.end_time)}{' '}
                <span class="workout-hint">
                  ({Math.round(s.confidence * 100)}% — {s.reasons.join('; ')})
                </span>
              </span>
              <button
                type="button"
                class="btn-small primary"
                onClick={async () => {
                  await linkWorkout(manualMember?.activity_id ?? workout.id, s.activity_id)
                  await refresh()
                }}
              >
                Merge
              </button>
            </div>
          ))}
          {workout.links
            .filter((l) => l.status === 'rejected')
            .map((l) => (
              <div class="workout-hint" key={`r-${l.primary_id}-${l.linked_id}`}>
                Kept separate from activity {l.primary_id === workout.id ? l.linked_id : l.primary_id}{' '}
                (unlinked).
              </div>
            ))}
        </section>
      )}

      <section class="workout-section">
        <h2>Notes</h2>
        {editingMeta ? (
          <EditMeta
            workout={workout}
            onDone={async () => {
              setEditingMeta(false)
              await refresh()
            }}
          />
        ) : (
          <>
            <p style={{ whiteSpace: 'pre-wrap' }}>
              {workout.notes ?? <span class="workout-empty">No notes</span>}
            </p>
            <button type="button" class="btn-small" onClick={() => setEditingMeta(true)}>
              Edit title, time and notes
            </button>{' '}
            {manualMember && (
              <button type="button" class="btn-small danger" onClick={removeWorkout}>
                Delete logged sets
              </button>
            )}{' '}
            <a href={`/detail/activity/${workout.id}`} class="workout-hint">
              Raw activity view
            </a>
          </>
        )}
      </section>

      <section class="workout-section">
        <h2>Provenance</h2>
        <table class="workout-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Role</th>
              <th>Time</th>
              <th>Id</th>
            </tr>
          </thead>
          <tbody>
            {workout.sources_detail.map((s) => (
              <tr key={s.activity_id}>
                <td>{sourceName(s.source)}</td>
                <td>{s.role}</td>
                <td>
                  {timeOf(s.start_time)}–{timeOf(s.end_time)}
                </td>
                <td class="workout-hint">{s.external_id ?? s.activity_id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
