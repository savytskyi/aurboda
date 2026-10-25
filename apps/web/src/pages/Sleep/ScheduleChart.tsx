import type { OptimalBedtime, SleepScheduleData, SleepScheduleNight } from '@aurboda/api-spec'

import * as d3 from 'd3'

import {
  AXIS_TEXT_COLOR,
  CHART_MARGIN,
  ChartEmpty,
  chartFocusProps,
  ChartTooltip,
  pointerIndex,
  useChartCursor,
  XAxisLabels,
  YGrid,
} from '../Health/chartParts'
import { clockLabel, formatDuration, parseDay, shortDate } from '../Health/format'
import { timeTickFormat, timeTicks } from '../Health/trendChartUtils'
import { useContainerWidth } from '../Health/useContainerWidth'
import { clockDomain, clockTicks, wakeOnBedtimeScale } from './schedule'

const BAR = 'var(--h-series-1)'
const MEAN = 'var(--h-ink-3)'
const OPTIMAL = 'var(--h-series-3)'

export interface ScheduleChartProps {
  data: SleepScheduleData
  start: string
  end: string
  height?: number
}

interface Layout {
  barWidth: number
  centre: (day: string) => number
  dayWidth: number
  innerHeight: number
  innerWidth: number
  spanDays: number
  x: d3.ScaleTime<number, number>
  y: d3.ScaleLinear<number, number>
}

const layoutFor = (
  start: string,
  end: string,
  domain: [number, number],
  width: number,
  height: number,
): Layout => {
  const innerWidth = Math.max(0, width - CHART_MARGIN.left - CHART_MARGIN.right)
  const innerHeight = height - CHART_MARGIN.top - CHART_MARGIN.bottom
  const startDate = parseDay(start)
  const endDate = d3.timeDay.offset(parseDay(end), 1)
  const spanDays = Math.max(1, d3.timeDay.count(startDate, endDate))
  const x = d3.scaleTime().domain([startDate, endDate]).range([0, innerWidth])
  const y = d3.scaleLinear().domain(domain).range([0, innerHeight])
  const dayWidth = innerWidth / spanDays
  return {
    barWidth: Math.max(2, Math.min(24, dayWidth * 0.6)),
    centre: (day) => x(parseDay(day)) + dayWidth / 2,
    dayWidth,
    innerHeight,
    innerWidth,
    spanDays,
    x,
    y,
  }
}

function Legend({ hasOptimal }: { hasOptimal: boolean }) {
  return (
    <div class="health-legend">
      <span class="health-legend-item">
        <span class="health-swatch" style={{ background: BAR }} />
        In bed
      </span>
      <span class="health-legend-item">
        <span class="health-line-key" style={{ background: MEAN, height: '1px' }} />
        Average bedtime / wake
      </span>
      {hasOptimal && (
        <span class="health-legend-item">
          <span class="health-swatch" style={{ background: 'var(--h-optimal-key)' }} />
          Oura optimal bedtime
        </span>
      )}
    </div>
  )
}

function MeanLine({ value, layout }: { value: number | null; layout: Layout }) {
  if (value === null) return null
  return (
    <line x1={0} x2={layout.innerWidth} y1={layout.y(value)} y2={layout.y(value)} style={{ stroke: MEAN }} />
  )
}

function OptimalBand({ window, layout }: { window: OptimalBedtime | null; layout: Layout }) {
  if (!window) return null
  const top = layout.y(window.start_clock_min)
  return (
    <rect
      x={0}
      width={layout.innerWidth}
      y={top}
      height={Math.max(1, layout.y(window.end_clock_min) - top)}
      style={{ fill: OPTIMAL }}
      fill-opacity={0.15}
    />
  )
}

function NightBars({
  nights,
  layout,
  active,
}: {
  nights: SleepScheduleNight[]
  layout: Layout
  active: number | null
}) {
  return (
    <>
      {nights.map((n, i) => {
        const top = layout.y(n.bedtime_clock_min)
        const bottom = layout.y(wakeOnBedtimeScale(n.wake_clock_min))
        return (
          <rect
            key={n.date}
            x={layout.centre(n.date) - layout.barWidth / 2}
            width={layout.barWidth}
            y={top}
            height={Math.max(2, bottom - top)}
            rx={Math.min(4, layout.barWidth / 2)}
            style={{ fill: BAR }}
            fill-opacity={active === null || active === i ? 1 : 0.55}
          />
        )
      })}
    </>
  )
}

function NightTooltip({ night }: { night: SleepScheduleNight }) {
  const inBedSec = (new Date(night.bedtime_end).getTime() - new Date(night.bedtime_start).getTime()) / 1000
  return (
    <>
      <div class="health-tooltip-date">Woke {shortDate(night.date)}</div>
      <div class="health-tooltip-row">
        <strong>
          {clockLabel(night.bedtime_clock_min)} → {clockLabel(night.wake_clock_min)}
        </strong>
      </div>
      <div class="health-tooltip-row">
        <span class="health-tooltip-label">{formatDuration(inBedSec)} in bed</span>
      </div>
    </>
  )
}

function SchedulePlot({
  data,
  domain,
  layout,
  width,
  height,
  active,
  onPointerMove,
  onPointerLeave,
}: {
  data: SleepScheduleData
  domain: [number, number]
  layout: Layout
  width: number
  height: number
  active: number | null
  onPointerMove: (event: PointerEvent) => void
  onPointerLeave: () => void
}) {
  const hovered = active === null ? null : (data.nights[active] ?? null)
  const wakeMean = data.stats.wake_mean_clock_min
  return (
    <svg width={width} height={height} aria-hidden="true">
      <g transform={`translate(${CHART_MARGIN.left},${CHART_MARGIN.top})`}>
        <OptimalBand window={data.recommendation?.optimal ?? null} layout={layout} />
        <YGrid ticks={clockTicks(domain)} yOf={layout.y} width={layout.innerWidth} label={clockLabel} />
        <XAxisLabels
          ticks={timeTicks(layout.x, layout.spanDays, layout.innerWidth)}
          xOf={(d) => layout.x(d) + layout.dayWidth / 2}
          y={layout.innerHeight}
          format={timeTickFormat(layout.spanDays)}
        />
        <NightBars nights={data.nights} layout={layout} active={active} />
        <MeanLine value={data.stats.bedtime_mean_clock_min} layout={layout} />
        <MeanLine value={wakeMean === null ? null : wakeOnBedtimeScale(wakeMean)} layout={layout} />
        {hovered && (
          <line
            x1={layout.centre(hovered.date)}
            x2={layout.centre(hovered.date)}
            y1={0}
            y2={layout.innerHeight}
            style={{ stroke: AXIS_TEXT_COLOR }}
            stroke-opacity={0.5}
            pointer-events="none"
          />
        )}
        <rect
          width={layout.innerWidth}
          height={layout.innerHeight}
          fill="transparent"
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
        />
      </g>
    </svg>
  )
}

export function ScheduleChart({ data, start, end, height = 240 }: ScheduleChartProps) {
  const [containerRef, width] = useContainerWidth<HTMLDivElement>()
  const nights = data.nights
  const optimal = data.recommendation?.optimal ?? null
  const domain = clockDomain(nights, optimal)
  const cursor = useChartCursor(nights.length)
  const layout = domain ? layoutFor(start, end, domain, width, height) : null
  const enough = nights.length >= 2 && layout !== null && domain !== null
  const hovered = nights[cursor.index ?? -1] ?? null

  const onPointerMove = (event: PointerEvent) =>
    cursor.setIndex(pointerIndex(event, layout ? nights.map((n) => layout.centre(n.date)) : []))
  const label = `Sleep schedule, ${nights.length} nights from ${shortDate(start)} to ${shortDate(end)}. Use arrow keys to read each night.`

  return (
    <div class="health-chart">
      {enough && <Legend hasOptimal={optimal !== null} />}
      <div
        ref={containerRef}
        class="health-chart-frame"
        style={{ minHeight: `${height}px` }}
        {...chartFocusProps(enough, label)}
        onKeyDown={cursor.onKeyDown}
        onBlur={cursor.clear}
      >
        {!enough && <ChartEmpty height={height} message="Not enough nights in this range yet." />}
        {enough && width > 0 && (
          <SchedulePlot
            data={data}
            domain={domain}
            layout={layout}
            width={width}
            height={height}
            active={cursor.index}
            onPointerMove={onPointerMove}
            onPointerLeave={cursor.clear}
          />
        )}
        {hovered && layout && (
          <ChartTooltip anchorX={layout.centre(hovered.date) + CHART_MARGIN.left} containerWidth={width}>
            <NightTooltip night={hovered} />
          </ChartTooltip>
        )}
      </div>
    </div>
  )
}
