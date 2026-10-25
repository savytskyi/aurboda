import { formatDuration } from './format'
import { stressSplit } from './overviewModel'
import './health.css'

export const STRESS_COLOR = 'var(--h-series-2)'
export const RESTORE_COLOR = 'var(--h-series-3)'

/** One 100 % bar of high-stress vs restorative time with a legend; null when both are zero or missing. */
export function StressSplitBar({
  stressSec,
  restorativeSec,
}: {
  stressSec: number | null
  restorativeSec: number | null
}) {
  const split = stressSplit({ recovery_high_sec: restorativeSec, stress_high_sec: stressSec })
  if (!split) return null
  return (
    <>
      <div
        class="health-split"
        role="img"
        aria-label={`High stress ${formatDuration(split.stressSec)}, restorative ${formatDuration(split.restorativeSec)}`}
      >
        {split.stressSec > 0 && <div class="health-split-stress" style={{ flexGrow: split.stressSec }} />}
        {split.restorativeSec > 0 && (
          <div class="health-split-restore" style={{ flexGrow: split.restorativeSec }} />
        )}
      </div>
      <div class="health-legend health-split-legend">
        <span class="health-legend-item">
          <span class="health-swatch" style={{ background: STRESS_COLOR }} />
          High stress <strong>{formatDuration(split.stressSec)}</strong>
        </span>
        <span class="health-legend-item">
          <span class="health-swatch" style={{ background: RESTORE_COLOR }} />
          Restorative <strong>{formatDuration(split.restorativeSec)}</strong>
        </span>
      </div>
    </>
  )
}
