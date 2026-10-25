import { formatDuration } from './format'
import './health.css'

export interface SleepStages {
  deep: number | null
  light: number | null
  rem: number | null
  awake: number | null
}

export interface StageBarProps {
  /** Seconds per stage. */
  stages: SleepStages
  label: string
}

export const STAGE_ORDER = [
  { color: 'var(--h-stage-deep)', key: 'deep', label: 'Deep' },
  { color: 'var(--h-stage-light)', key: 'light', label: 'Light' },
  { color: 'var(--h-stage-rem)', key: 'rem', label: 'REM' },
  { color: 'var(--h-stage-awake)', key: 'awake', label: 'Awake' },
] as const

export const stageShares = (stages: SleepStages) => {
  const total = STAGE_ORDER.reduce((sum, s) => sum + (stages[s.key] ?? 0), 0)
  if (total <= 0) return []
  return STAGE_ORDER.map((s) => {
    const sec = stages[s.key] ?? 0
    return { ...s, percent: (sec / total) * 100, sec }
  })
}

export function StageBar({ stages, label }: StageBarProps) {
  const shares = stageShares(stages)
  if (shares.length === 0) {
    return (
      <div class="health-stage">
        <div class="health-stage-title">{label}</div>
        <div class="health-muted">No stage data</div>
      </div>
    )
  }
  const summary = shares
    .map((s) => `${s.label} ${formatDuration(s.sec)} (${Math.round(s.percent)}%)`)
    .join(', ')
  return (
    <div class="health-stage">
      <div class="health-stage-title">{label}</div>
      <div class="health-stage-bar" role="img" aria-label={`${label}: ${summary}`}>
        {shares
          .filter((s) => s.sec > 0)
          .map((s) => (
            <div
              key={s.key}
              class="health-stage-seg"
              style={{ background: s.color, flexGrow: s.sec }}
              title={`${s.label}: ${formatDuration(s.sec)} (${Math.round(s.percent)}%)`}
            />
          ))}
      </div>
      <ul class="health-stage-legend">
        {shares.map((s) => (
          <li key={s.key}>
            <span class="health-swatch" style={{ background: s.color }} />
            <span>{s.label}</span>
            <strong>{formatDuration(s.sec)}</strong>
            <span class="health-muted">{Math.round(s.percent)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
