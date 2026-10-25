import type { ComponentChildren, JSX } from 'preact'

import { useState } from 'preact/hooks'

import { nearestIndex, stepIndex } from './trendChartUtils'

export const CHART_MARGIN = { bottom: 24, left: 44, right: 12, top: 12 }
/** Theme tokens from health.css; apply them through `style`, never SVG presentation attributes. */
export const GRID_COLOR = 'var(--h-grid)'
export const AXIS_TEXT_COLOR = 'var(--h-axis)'

/** Focusable, labelled chart frame once there is something to read. */
export const chartFocusProps = (enabled: boolean, label: string): JSX.HTMLAttributes<HTMLDivElement> =>
  enabled ? { 'aria-label': label, role: 'img', tabIndex: 0 } : {}

/** Index of the x position nearest the pointer over the plot's hit rect. */
export const pointerIndex = (event: PointerEvent, positions: readonly number[]): number | null => {
  if (positions.length === 0) return null
  const rect = (event.currentTarget as Element).getBoundingClientRect()
  return nearestIndex(positions, event.clientX - rect.left)
}

/** Hover/focus index over `count` x positions, driven by pointer and arrow keys. */
export const useChartCursor = (count: number) => {
  const [index, setIndex] = useState<number | null>(null)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      setIndex(null)
      return
    }
    const next = stepIndex(event.key, index, count - 1)
    if (next === null) return
    event.preventDefault()
    setIndex(next)
  }
  const clear = () => setIndex(null)
  const active = index !== null && index < count ? index : null
  return { clear, index: active, onKeyDown, setIndex }
}

export function XAxisLabels({
  ticks,
  xOf,
  y,
  format,
}: {
  ticks: Date[]
  xOf: (d: Date) => number
  y: number
  format: (d: Date) => string
}) {
  return (
    <>
      {ticks.map((t) => (
        <text
          key={t.getTime()}
          x={xOf(t)}
          y={y + 16}
          text-anchor="middle"
          style={{ fill: AXIS_TEXT_COLOR }}
          font-size="11"
        >
          {format(t)}
        </text>
      ))}
    </>
  )
}

export function YGrid({
  ticks,
  yOf,
  width,
  label,
}: {
  ticks: number[]
  yOf: (v: number) => number
  width: number
  label: (v: number) => string
}) {
  return (
    <>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={0} x2={width} y1={yOf(t)} y2={yOf(t)} style={{ stroke: GRID_COLOR }} stroke-width={1} />
          <text
            x={-8}
            y={yOf(t)}
            dy="0.32em"
            text-anchor="end"
            style={{ fill: AXIS_TEXT_COLOR }}
            font-size="11"
          >
            {label(t)}
          </text>
        </g>
      ))}
    </>
  )
}

/** Positioned next to the crosshair at `anchorX`, flipped left near the right edge. */
export function ChartTooltip({
  anchorX,
  containerWidth,
  children,
}: {
  anchorX: number
  containerWidth: number
  children: ComponentChildren
}) {
  const flip = anchorX + 180 > containerWidth
  return (
    <div
      class="health-tooltip"
      style={{
        left: flip ? undefined : `${anchorX + 12}px`,
        right: flip ? `${containerWidth - anchorX + 12}px` : undefined,
        top: `${CHART_MARGIN.top}px`,
      }}
    >
      {children}
    </div>
  )
}

export function ChartEmpty({ height, message }: { height: number; message: string }) {
  return (
    <div class="health-chart-empty" style={{ height: `${height}px` }}>
      {message}
    </div>
  )
}
