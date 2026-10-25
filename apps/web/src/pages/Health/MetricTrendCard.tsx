import type { HealthDailyPoint } from '@aurboda/api-spec'

import { useEffect } from 'preact/hooks'

import { formatMetricValue, metricLabel } from './format'
import { normalRangeText } from './overviewModel'
import { latestPoint } from './series'
import { TrendChart, type TrendChartProps } from './TrendChart'
import './health.css'

/** Categorical slots 1–4 as theme tokens (health.css); use through `style`. */
export const SERIES_COLORS = [
  'var(--h-series-1)',
  'var(--h-series-2)',
  'var(--h-series-3)',
  'var(--h-series-4)',
] as const

export interface MetricTrendCardProps {
  metric: string
  points: HealthDailyPoint[]
  start: string
  end: string
  /** Defaults to the catalog label. */
  title?: string
  caption?: string
  /** Sets `id` so `#<metric>` links land on the card. */
  anchor?: boolean
  height?: number
  zeroLine?: boolean
  referenceLine?: TrendChartProps['referenceLine']
  smooth?: boolean
  band?: boolean
}

export function MetricTrendCard({
  metric,
  points,
  start,
  end,
  title,
  caption,
  anchor = false,
  height = 180,
  zeroLine,
  referenceLine,
  smooth,
  band,
}: MetricTrendCardProps) {
  const label = title ?? metricLabel(metric)
  const latest = latestPoint(points)
  const normal = latest ? normalRangeText(metric, latest.baseline) : null
  return (
    <div class="health-card" id={anchor ? metric : undefined}>
      <div class="health-card-header">
        <h3>{label}</h3>
        <span>
          <span class="health-card-value">{formatMetricValue(metric, latest?.value ?? null)}</span>
          {normal && <span class="health-muted"> · {normal}</span>}
        </span>
      </div>
      <TrendChart
        series={[{ color: SERIES_COLORS[0], label, metric, points }]}
        start={start}
        end={end}
        height={height}
        zeroLine={zeroLine}
        referenceLine={referenceLine}
        smooth={smooth}
        band={band}
      />
      {caption && <div class="health-caption">{caption}</div>}
    </div>
  )
}

/** Scrolls to `location.hash` once the anchored content has rendered. */
export const useHashScroll = (ready: boolean) => {
  useEffect(() => {
    if (!ready || typeof window === 'undefined') return
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!id) return
    document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }, [ready])
}
