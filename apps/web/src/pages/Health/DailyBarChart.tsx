import * as d3 from 'd3'
import { useMemo } from 'preact/hooks'

import {
  AXIS_TEXT_COLOR,
  CHART_MARGIN,
  ChartEmpty,
  chartFocusProps,
  ChartTooltip,
  pointerIndex,
  useChartCursor,
  YGrid,
} from './chartParts'
import { type BarSeriesValues, labelIndices, stackBars, type StackSegment, unitTicks } from './dailyBarUtils'
import { shortDate } from './format'
import { useContainerWidth } from './useContainerWidth'
import './health.css'

export interface DailyBarSeries extends BarSeriesValues {
  label: string
  color: string
}

export interface DailyBarChartProps {
  /** One bar per bucket (a day, or a week's Monday), ascending. */
  dates: string[]
  series: DailyBarSeries[]
  formatValue: (value: number) => string
  formatTick: (value: number) => string
  /** Short text above a bar (✓, a count). */
  markers?: ReadonlyMap<string, string>
  /** Explains the markers in the legend. */
  markerLegend?: string
  referenceLine?: { value: number; label: string }
  /** Extra tooltip line for a bucket. */
  tooltipNote?: (date: string) => string | null
  /** Tooltip / aria heading for a bucket; defaults to the short date. */
  bucketLabel?: (date: string) => string
  /** Summary for screen readers. */
  ariaLabel: string
  height?: number
  emptyMessage?: string
  /** Put y ticks on round multiples of this (e.g. 3600 for seconds shown as hours). */
  tickUnit?: number
}

const MAX_BAR = 24
const GAP = 2
const RADIUS = 4
const MARKER_SPACE = 14

/** A bar segment with the far-from-zero corners rounded when it is the outer one. */
const segmentPath = (x: number, w: number, yNear: number, yFar: number, round: boolean): string => {
  const up = yFar < yNear
  const h = Math.abs(yNear - yFar)
  const r = round ? Math.min(RADIUS, w / 2, h) : 0
  const top = Math.min(yNear, yFar)
  const bottom = Math.max(yNear, yFar)
  if (r === 0) return `M${x},${top}h${w}v${h}h${-w}Z`
  return up
    ? `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bottom}Z`
    : `M${x},${top}H${x + w}V${bottom - r}Q${x + w},${bottom} ${x + w - r},${bottom}H${x + r}Q${x},${bottom} ${x},${bottom - r}Z`
}

function Legend({ series, markerLegend }: { series: DailyBarSeries[]; markerLegend?: string }) {
  if (series.length < 2 && !markerLegend) return null
  return (
    <div class="health-legend">
      {series.length >= 2 &&
        series.map((s) => (
          <span key={s.key} class="health-legend-item">
            <span class="health-swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      {markerLegend && <span class="health-legend-item">{markerLegend}</span>}
    </div>
  )
}

type Stack = ReturnType<typeof stackBars>

const buildGeometry = (
  dates: string[],
  stack: Stack,
  width: number,
  height: number,
  topSpace: number,
  referenceValue: number | null,
  tickUnit?: number,
) => {
  const innerWidth = Math.max(0, width - CHART_MARGIN.left - CHART_MARGIN.right)
  const innerHeight = height - CHART_MARGIN.top - CHART_MARGIN.bottom - topSpace
  const x = d3.scaleBand<string>().domain(dates).range([0, innerWidth]).paddingInner(0.2).paddingOuter(0.1)
  const hi = Math.max(stack.max, referenceValue ?? 0)
  const ticks = tickUnit ? unitTicks(stack.min, hi > 0 ? hi : tickUnit, tickUnit) : null
  const y = d3
    .scaleLinear()
    .domain(ticks ? [ticks[0]!, ticks.at(-1)!] : [stack.min, hi > 0 ? hi : 1])
    .range([innerHeight, 0])
  if (!ticks) y.nice(4)
  const yTicks = ticks ?? y.ticks(4)
  const barWidth = Math.min(MAX_BAR, x.bandwidth())
  const barX = (date: string) => (x(date) ?? 0) + (x.bandwidth() - barWidth) / 2
  const centre = (date: string) => (x(date) ?? 0) + x.bandwidth() / 2
  const segmentShape = (date: string, seg: StackSegment, index: number) => {
    const near = y(seg.y0)
    const inner = index > 0 && seg.y0 !== 0
    const nearPx = inner ? near + (seg.y1 > 0 ? -GAP : GAP) : near
    const far = seg.y1 > 0 ? Math.min(y(seg.y1), nearPx) : Math.max(y(seg.y1), nearPx)
    return segmentPath(barX(date), barWidth, nearPx, far, seg.outer)
  }
  return { centre, innerHeight, innerWidth, segmentShape, x, y, yTicks }
}

type Geometry = ReturnType<typeof buildGeometry>

function ReferenceLine({ line, geo }: { line: { value: number; label: string }; geo: Geometry }) {
  const y = geo.y(line.value)
  return (
    <g>
      <line
        x1={0}
        x2={geo.innerWidth}
        y1={y}
        y2={y}
        style={{ stroke: AXIS_TEXT_COLOR }}
        stroke-dasharray="4 3"
      />
      <text x={geo.innerWidth} y={y - 4} text-anchor="end" style={{ fill: AXIS_TEXT_COLOR }} font-size="11">
        {line.label}
      </text>
    </g>
  )
}

function Markers({
  stack,
  markers,
  geo,
}: {
  stack: Stack
  markers: ReadonlyMap<string, string>
  geo: Geometry
}) {
  return (
    <>
      {stack.bars.map((b) => {
        const text = markers.get(b.date)
        if (!text) return null
        const top = b.segments.reduce((m, s) => Math.max(m, s.y1), 0)
        return (
          <text
            key={b.date}
            x={geo.centre(b.date)}
            y={geo.y(top) - 4}
            text-anchor="middle"
            style={{ fill: 'var(--h-ink-3)' }}
            font-size="10"
          >
            {text}
          </text>
        )
      })}
    </>
  )
}

function BarPlot({
  dates,
  stack,
  series,
  geo,
  width,
  height,
  topSpace,
  formatTick,
  markers,
  referenceLine,
  hoverDate,
  onPointerMove,
  onPointerLeave,
}: {
  dates: string[]
  stack: Stack
  series: DailyBarSeries[]
  geo: Geometry
  width: number
  height: number
  topSpace: number
  formatTick: (value: number) => string
  markers?: ReadonlyMap<string, string>
  referenceLine?: { value: number; label: string }
  hoverDate: string | null
  onPointerMove: (event: PointerEvent) => void
  onPointerLeave: () => void
}) {
  const { innerHeight, innerWidth, x, y, yTicks } = geo
  const colorOf = new Map(series.map((s) => [s.key, s.color]))
  return (
    <svg width={width} height={height} aria-hidden="true">
      <g transform={`translate(${CHART_MARGIN.left},${CHART_MARGIN.top + topSpace})`}>
        <YGrid ticks={yTicks} yOf={y} width={innerWidth} label={formatTick} />
        {labelIndices(dates.length, x.step()).map((i) => {
          const date = dates[i] ?? ''
          return (
            <text
              key={date}
              x={geo.centre(date)}
              y={innerHeight + 16}
              text-anchor="middle"
              style={{ fill: AXIS_TEXT_COLOR }}
              font-size="11"
            >
              {shortDate(date)}
            </text>
          )
        })}
        {hoverDate !== null && (
          <rect
            x={x(hoverDate) ?? 0}
            width={x.bandwidth()}
            y={0}
            height={innerHeight}
            style={{ fill: 'var(--h-hover-fill)' }}
            pointer-events="none"
          />
        )}
        {stack.bars.map((b) => (
          <g key={b.date}>
            {b.segments.map((seg, i) => (
              <path
                key={seg.key}
                d={geo.segmentShape(b.date, seg, i)}
                style={{ fill: colorOf.get(seg.key) }}
              />
            ))}
          </g>
        ))}
        {stack.min < 0 && (
          <line
            x1={0}
            x2={innerWidth}
            y1={y(0)}
            y2={y(0)}
            style={{ stroke: AXIS_TEXT_COLOR }}
            stroke-width={1}
          />
        )}
        {referenceLine && <ReferenceLine line={referenceLine} geo={geo} />}
        {markers && <Markers stack={stack} markers={markers} geo={geo} />}
        <rect
          width={innerWidth}
          height={innerHeight}
          fill="transparent"
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
        />
      </g>
    </svg>
  )
}

function BarTooltip({
  date,
  anchorX,
  containerWidth,
  series,
  formatValue,
  bucketLabel,
  tooltipNote,
}: {
  date: string | null
  anchorX: number
  containerWidth: number
  series: DailyBarSeries[]
  formatValue: (value: number) => string
  bucketLabel: (date: string) => string
  tooltipNote?: (date: string) => string | null
}) {
  if (date === null) return null
  const note = tooltipNote?.(date) ?? null
  return (
    <ChartTooltip anchorX={anchorX} containerWidth={containerWidth}>
      <div class="health-tooltip-date">{bucketLabel(date)}</div>
      {series.map((s) => {
        const value = s.values.get(date)
        return (
          <div key={s.key} class="health-tooltip-row">
            <span class="health-swatch" style={{ background: s.color }} />
            <strong>{value === undefined ? '—' : formatValue(value)}</strong>
            <span class="health-tooltip-label">{s.label}</span>
          </div>
        )
      })}
      {note && <div class="health-tooltip-label">{note}</div>}
    </ChartTooltip>
  )
}

export function DailyBarChart({
  dates,
  series,
  formatValue,
  formatTick,
  markers,
  markerLegend,
  referenceLine,
  tooltipNote,
  bucketLabel = shortDate,
  ariaLabel,
  height = 180,
  emptyMessage = 'Not enough data in this range yet.',
  tickUnit,
}: DailyBarChartProps) {
  const [containerRef, width] = useContainerWidth<HTMLDivElement>()
  const stack = useMemo(() => stackBars(dates, series), [dates, series])
  const enough = stack.bars.filter((b) => b.segments.length > 0).length >= 2
  const cursor = useChartCursor(dates.length)
  const topSpace = markers && markers.size > 0 ? MARKER_SPACE : 0
  const geo = buildGeometry(dates, stack, width, height, topSpace, referenceLine?.value ?? null, tickUnit)
  const hoverDate = cursor.index === null ? null : (dates[cursor.index] ?? null)

  return (
    <div class="health-chart">
      <Legend series={series} markerLegend={markerLegend} />
      <div
        ref={containerRef}
        class="health-chart-frame"
        style={{ minHeight: `${height}px` }}
        {...chartFocusProps(enough, `${ariaLabel} Use arrow keys to read values.`)}
        onKeyDown={cursor.onKeyDown}
        onBlur={cursor.clear}
      >
        {!enough && <ChartEmpty height={height} message={emptyMessage} />}
        {enough && width > 0 && (
          <BarPlot
            dates={dates}
            stack={stack}
            series={series}
            geo={geo}
            width={width}
            height={height}
            topSpace={topSpace}
            formatTick={formatTick}
            markers={markers}
            referenceLine={referenceLine}
            hoverDate={hoverDate}
            onPointerMove={(event) => cursor.setIndex(pointerIndex(event, dates.map(geo.centre)))}
            onPointerLeave={cursor.clear}
          />
        )}
        <BarTooltip
          date={hoverDate}
          anchorX={hoverDate === null ? 0 : geo.centre(hoverDate) + CHART_MARGIN.left}
          containerWidth={width}
          series={series}
          formatValue={formatValue}
          bucketLabel={bucketLabel}
          tooltipNote={tooltipNote}
        />
      </div>
    </div>
  )
}
