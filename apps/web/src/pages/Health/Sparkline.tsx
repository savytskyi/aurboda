import type { HealthDailyPoint } from '@aurboda/api-spec'

import * as d3 from 'd3'
import { useMemo } from 'preact/hooks'

import { ChartTooltip, chartFocusProps, pointerIndex, useChartCursor } from './chartParts'
import { formatMetricRange, formatMetricValue, normalBounds, shortDate } from './format'
import { bandSegments, daysBetween, paddedDomain } from './trendChartUtils'
import { useContainerWidth } from './useContainerWidth'
import './health.css'

export interface SparklineProps {
  metric: string
  points: HealthDailyPoint[]
  start: string
  end: string
  height?: number
  color?: string
  /** Shade the personal-normal band behind the line. */
  band?: boolean
}

const PAD = { bottom: 4, left: 2, right: 6, top: 6 }

function SparkTooltip({
  metric,
  point,
  anchorX,
  width,
}: {
  metric: string
  point: HealthDailyPoint
  anchorX: number
  width: number
}) {
  const bounds = point.baseline ? normalBounds(metric, point.baseline) : null
  return (
    <ChartTooltip anchorX={anchorX} containerWidth={width}>
      <div class="health-tooltip-date">{shortDate(point.date)}</div>
      <div class="health-tooltip-row">
        <strong>{formatMetricValue(metric, point.value)}</strong>
      </div>
      {bounds && (
        <div class="health-tooltip-normal">normal {formatMetricRange(metric, bounds.lo, bounds.hi)}</div>
      )}
    </ChartTooltip>
  )
}

/** Days, lookup, band and padded y domain of a sparkline (pure). */
export const sparkModel = (
  points: readonly HealthDailyPoint[],
  start: string,
  end: string,
  band: boolean,
  metric: string,
) => {
  const days = daysBetween(start, end)
  const byDate = new Map(points.map((p) => [p.date, p]))
  const segments = band ? bandSegments(points, metric) : []
  const domain = paddedDomain([
    ...points.map((p) => p.value),
    ...segments.flat().flatMap((b) => [b.lo, b.hi]),
  ])
  return { byDate, days, domain, segments }
}

/** x position of each day, spread evenly across the width. */
export const sparkX = (days: readonly string[], width: number) => {
  const innerWidth = Math.max(0, width - PAD.left - PAD.right)
  const step = days.length > 1 ? innerWidth / (days.length - 1) : 0
  const indexOf = new Map(days.map((d, i) => [d, i]))
  return (day: string) => PAD.left + (indexOf.get(day) ?? 0) * step
}

/** A compact axis-free trend: the line, the personal-normal band and the latest value as a dot. */
export function Sparkline({
  metric,
  points,
  start,
  end,
  height = 48,
  color = 'var(--h-series-1)',
  band = true,
}: SparklineProps) {
  const [ref, width] = useContainerWidth<HTMLDivElement>()
  const model = useMemo(
    () => sparkModel(points, start, end, band, metric),
    [points, start, end, band, metric],
  )
  const hoverDays = model.days.filter((d) => model.byDate.has(d))
  const cursor = useChartCursor(hoverDays.length)

  if (points.length < 2 || !model.domain) {
    return <div class="health-spark-empty" style={{ height: `${height}px` }} />
  }

  const x = sparkX(model.days, width)
  const y = d3
    .scaleLinear()
    .domain(model.domain)
    .range([height - PAD.bottom, PAD.top])
  const line = d3
    .line<string>()
    .defined((d) => model.byDate.has(d))
    .x(x)
    .y((d) => y(model.byDate.get(d)?.value ?? 0))
  const area = d3
    .area<{ date: string; lo: number; hi: number }>()
    .x((d) => x(d.date))
    .y0((d) => y(d.lo))
    .y1((d) => y(d.hi))
  const latest = points.at(-1)!
  const hoverDay = cursor.index === null ? null : (hoverDays[cursor.index] ?? null)
  const hovered = hoverDay ? model.byDate.get(hoverDay) : undefined
  const positions = hoverDays.map(x)
  const label = `${shortDate(start)} to ${shortDate(end)}: latest ${formatMetricValue(metric, latest.value)} on ${shortDate(latest.date)}`

  return (
    <div
      ref={ref}
      class="health-spark"
      onKeyDown={cursor.onKeyDown}
      onBlur={cursor.clear}
      {...chartFocusProps(true, label)}
    >
      {width > 0 && (
        <svg width={width} height={height} aria-hidden="true">
          {model.segments.map((seg) => (
            <path
              key={seg[0]?.date}
              d={area(seg) ?? ''}
              style={{ fill: 'var(--h-band-fill)', fillOpacity: 'var(--h-band-opacity)' }}
            />
          ))}
          <path
            d={line(model.days) ?? ''}
            style={{ fill: 'none', stroke: color }}
            stroke-width={2}
            stroke-linejoin="round"
            stroke-linecap="round"
          />
          {hovered && (
            <line
              x1={x(hovered.date)}
              x2={x(hovered.date)}
              y1={PAD.top}
              y2={height - PAD.bottom}
              style={{ stroke: 'var(--h-axis)' }}
              stroke-width={1}
            />
          )}
          <circle
            cx={x((hovered ?? latest).date)}
            cy={y((hovered ?? latest).value)}
            r={4}
            style={{ fill: color, stroke: 'var(--h-dot-ring)' }}
            stroke-width={2}
          />
          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            fill="transparent"
            onPointerMove={(e) => cursor.setIndex(pointerIndex(e, positions))}
            onPointerLeave={cursor.clear}
          />
        </svg>
      )}
      {hovered && <SparkTooltip metric={metric} point={hovered} anchorX={x(hovered.date)} width={width} />}
    </div>
  )
}
