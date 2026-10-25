import type { DeltaTone } from './format'

import { StatusChip, type StatusChipProps } from './StatusChip'
import './health.css'

export interface StatTileProps {
  label: string
  value: string
  caption?: string
  delta?: { text: string; tone: DeltaTone }
  /** Makes the whole tile a link. */
  href?: string
  status?: StatusChipProps
}

export function StatTile({ label, value, caption, delta, href, status }: StatTileProps) {
  const body = (
    <>
      <div class="health-tile-label">{label}</div>
      <div class="health-tile-value">{value}</div>
      {delta && <div class={`health-delta health-delta-${delta.tone}`}>{delta.text}</div>}
      {status && (
        <div class="health-tile-status">
          <StatusChip {...status} />
        </div>
      )}
      {caption && <div class="health-tile-caption">{caption}</div>}
    </>
  )
  return href ? (
    <a class="health-card health-tile health-tile-link" href={href}>
      {body}
    </a>
  ) : (
    <div class="health-card health-tile">{body}</div>
  )
}
